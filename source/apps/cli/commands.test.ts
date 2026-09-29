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

function capture(files: Record<string, string> = {}, stdin = '') {
  const written: Record<string, string> = {}
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    written,
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      readFile: (path: string) =>
        path in files
          ? Promise.resolve(files[path])
          : Promise.reject(new Error('no such file')),
      env: () => undefined,
      writeFile: (path: string, content: string) => {
        written[path] = content
        return Promise.resolve()
      },
      readTree: (dir: string) =>
        Promise.resolve(Object.fromEntries(
          Object.entries(files).filter(([p]) => p.startsWith(`${dir}/`))
            .map(([p, c]) => [p.slice(dir.length + 1), c]),
        )),
      readStdin: () => Promise.resolve(stdin),
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

Deno.test('cli: export writes every file of the bundle into --out', async () => {
  await withServer({
    'khatm.export': ok({
      revision,
      files: { 'manifest.json': '{}', 'branding/tokens.json': '{}' },
    }),
  }, async (socket, calls) => {
    const c = capture()
    assertEquals(
      await run(['export', 'rev-2', '--out', 'out', '--socket', socket], c.io),
      0,
    )
    assertEquals(calls[0].body, { revision: 'rev-2' })
    assertEquals(Object.keys(c.written).sort(), [
      'out/branding/tokens.json',
      'out/manifest.json',
    ])
  })
})

Deno.test("cli: import applies the bundle's authored manifest, and refuses a broken bundle", async () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const resolved = '{"auth":{}}'
  // A bundle that is internally consistent needs a real digest of manifest.json.
  const { digestOf } = await import('@khatm/spec')
  const manifestDigest = await digestOf(JSON.parse(resolved))
  const bundle = {
    'b/manifest.json': resolved,
    'b/revision.json': JSON.stringify({
      id: 'rev-9',
      manifest: manifestDigest,
    }),
    'b/lock.json': JSON.stringify({ manifest: manifestDigest }),
    'b/manifest.authored.json': '{"auth":{"from":"bundle"}}',
  }
  await withServer({
    'khatm.plan': ok({
      ...destructivePlan,
      needsConfirmation: false,
      impact: 'restart',
    }),
    'khatm.apply': ok({ revision, changed: true, plan: destructivePlan }),
  }, async (socket, calls) => {
    const good = capture(bundle)
    assertEquals(await run(['import', 'b', '--socket', socket], good.io), 0)
    assertEquals(calls[1].body, {
      manifest: { auth: { from: 'bundle' } },
      base: 'rev-1',
      confirmed: false,
      reason: 'import of revision rev-9',
    })

    const broken = capture({
      ...bundle,
      'b/lock.json': JSON.stringify({ manifest: digest }),
    })
    assertEquals(await run(['import', 'b', '--socket', socket], broken.io), 1)
    assertStringIncludes(broken.err.join('\n'), 'not an intact bundle')
    assertEquals(calls.length, 2)
  })
})

Deno.test('cli: guard prints the control manifest without reaching the orchestrator', async () => {
  const manifest = {
    auth: {
      baseURL: 'https://auth.example.com',
      secrets: [{ version: 1, value: { env: 'S' } }],
      database: { dialect: 'sqlite', url: { env: 'D' } },
      session: {
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'example',
        claims: ['email'],
      },
    },
  }
  const c = capture({ 'm.json': JSON.stringify(manifest) })
  assertEquals(await run(['guard', 'control', 'm.json'], c.io), 0)
  assertStringIncludes(c.out.join('\n'), 'id: khatm_control')
  assertStringIncludes(c.out.join('\n'), 'path: /khatm.apply')
  assertEquals(await run(['guard', 'elsewhere', 'm.json'], capture().io), 2)
})

const ada = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada',
  emailVerified: true,
  role: 'admin',
  banned: false,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
}

Deno.test('cli: users commands send the user as given and print the result', async () => {
  await withServer({
    'users.setRole': ok({ user: ada }),
    'users.setPassword': ok({ user: ada }),
    'users.list': ok({ users: [ada], total: 1 }),
    'sessions.revoke': ok({ revoked: 2 }),
  }, async (socket, calls) => {
    const c = capture({}, 'a-new-password\n')
    const at = ['--socket', socket]
    assertEquals(
      await run(['users', 'set-role', 'ada@example.com', 'admin', ...at], c.io),
      0,
    )
    assertEquals(
      await run(['users', 'set-password', 'ada@example.com', ...at], c.io),
      0,
    )
    assertEquals(
      await run(['users', 'list', '--search', 'ada', ...at], c.io),
      0,
    )
    assertEquals(await run(['sessions', 'revoke', 'u-1', ...at], c.io), 0)
    assertEquals(calls.map((call) => call.body), [
      { user: 'ada@example.com', role: 'admin' },
      { user: 'ada@example.com', password: 'a-new-password' },
      { search: 'ada', field: 'email', limit: 50, offset: 0 },
      { user: 'u-1' },
    ])
    assertStringIncludes(c.out.join('\n'), 'u-1  ada@example.com  Ada  admin')
    assertStringIncludes(c.out.join('\n'), 'Revoked 2 sessions')
  })
})

Deno.test('cli: users remove without --yes is refused by the server and needs the operator', async () => {
  await withServer({
    'users.remove': () =>
      Response.json({
        error: {
          code: 'confirmation_required',
          message: "Removing a user can't be undone",
        },
      }, { status: 409 }),
  }, async (socket, calls) => {
    const c = capture()
    assertEquals(
      await run(['users', 'remove', 'u-1', '--socket', socket], c.io),
      3,
    )
    assertEquals(calls[0].body, { user: 'u-1', confirmed: false })
  })
})
