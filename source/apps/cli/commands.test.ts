import { assertEquals, assertStringIncludes } from '@std/assert'
import { type ExitCode, run } from './commands.ts'

const destructivePlan = {
  base: 'rev-1',
  desired: 'sha256:x',
  impact: 'destructive',
  isEmpty: false,
  needsConfirmation: true,
  isBlocked: false,
  steps: [{
    path: 'secret[env:AUTH_SECRET]',
    impact: 'destructive',
    reason: 'The value behind this reference changed',
  }],
}
const revision = {
  id: 'rev-2',
  parent: 'rev-1',
  manifest: 'sha256:x',
  author: 'socket',
  createdAt: '2026-09-29T00:00:00.000Z',
}

/** A stand-in control server: records calls and answers from a table. */
async function withServer(
  answers: Record<string, () => Response>,
  test: (
    socket: string,
    calls: { name: string; body: unknown }[],
  ) => Promise<void>,
) {
  const dir = Deno.makeTempDirSync()
  const socket = `${dir}/c.sock`
  const calls: { name: string; body: unknown }[] = []
  const server = Deno.serve(
    { path: socket, onListen: () => {} },
    async (request) => {
      const name = new URL(request.url).pathname.slice(1)
      calls.push({ name, body: await request.json() })
      return answers[name]?.() ?? new Response('{}', { status: 404 })
    },
  )
  try {
    await test(socket, calls)
  } finally {
    await server.shutdown()
    Deno.removeSync(dir, { recursive: true })
  }
}

const ok = (body: unknown) => () => Response.json(body)

function capture(files: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      readFile: (path: string) =>
        path in files
          ? Promise.resolve(files[path])
          : Promise.reject(new Error('no such file')),
      env: () => undefined,
    },
  }
}

Deno.test('cli: plan prints each step with its impact and reason', async () => {
  await withServer(
    { 'khatm.plan': ok(destructivePlan) },
    async (socket, calls) => {
      const c = capture({ 'm.json': '{"auth":{}}' })
      const code = await run(['plan', 'm.json', '--socket', socket], c.io)
      assertEquals(code, 0)
      assertStringIncludes(c.out.join('\n'), 'destructive')
      assertStringIncludes(c.out.join('\n'), 'secret[env:AUTH_SECRET]')
      assertEquals(calls[0].body, { manifest: { auth: {} } })
    },
  )
})

Deno.test('cli: apply stops for confirmation, and --yes sends base and confirmation', async () => {
  await withServer({
    'khatm.plan': ok(destructivePlan),
    'khatm.apply': ok({ revision, changed: true, plan: destructivePlan }),
  }, async (socket, calls) => {
    const c = capture({ 'm.json': '{}' })
    assertEquals(await run(['apply', 'm.json', '--socket', socket], c.io), 3)
    assertEquals(calls.map((call) => call.name), ['khatm.plan'])
    assertStringIncludes(c.err.join('\n'), '--yes')

    const confirmed = capture({ 'm.json': '{}' })
    assertEquals(
      await run([
        'apply',
        'm.json',
        '--yes',
        '--reason',
        'rotate',
        '--socket',
        socket,
      ], confirmed.io),
      0,
    )
    assertEquals(calls[2].body, {
      manifest: {},
      base: 'rev-1',
      confirmed: true,
      reason: 'rotate',
    })
    assertStringIncludes(confirmed.out.join('\n'), 'Applied revision rev-2')
  })
})

Deno.test('cli: an empty plan applies nothing', async () => {
  const empty = {
    ...destructivePlan,
    isEmpty: true,
    steps: [],
    needsConfirmation: false,
  }
  await withServer({ 'khatm.plan': ok(empty) }, async (socket, calls) => {
    const c = capture({ 'm.json': '{}' })
    assertEquals(await run(['apply', 'm.json', '--socket', socket], c.io), 0)
    assertEquals(calls.length, 1)
    assertEquals(c.out, ['No changes'])
  })
})

Deno.test('cli: server errors are printed and mapped to exit codes', async () => {
  const fail = (code: string, status: number) => () =>
    Response.json({ error: { code, message: `it was ${code}` } }, { status })
  await withServer({
    'khatm.status': fail('internal', 500),
    'khatm.history': fail('blocked', 409),
  }, async (socket) => {
    const a = capture()
    assertEquals(await run(['status', '--socket', socket], a.io), 1)
    assertStringIncludes(a.err.join('\n'), 'it was internal')
    const b = capture()
    assertEquals(await run(['history', '--socket', socket], b.io), 3)
  })
})

Deno.test('cli: misuse exits 2 and an unreachable socket exits 1', async () => {
  const codes: ExitCode[] = []
  for (
    const args of [[], ['nonsense'], ['plan'], ['history', '--limit', 'x'], [
      '--bogus',
    ]]
  ) {
    codes.push(await run(args, capture().io))
  }
  assertEquals(codes, [2, 2, 2, 2, 2])
  const c = capture()
  assertEquals(
    await run(['status', '--socket', '/nonexistent/x.sock'], c.io),
    1,
  )
  assertStringIncludes(c.err.join('\n'), "Can't reach")
})
