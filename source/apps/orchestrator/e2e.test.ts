import { assert, assertEquals, assertRejects } from '@std/assert'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest, type ResolvedManifest } from '@khatm/spec'
import { UnhealthyWorkerError, type Workers } from '@khatm/deployment'
import { freePort, ManagedProcess } from '@khatm-libs/supervisor'
import { ControlService } from './control.ts'
import { createRuntime } from './runtime.ts'
import { openSql } from './sql.ts'

const POSTGRES = Deno.env.get('KHATM_TEST_POSTGRES')
const WORKER = new URL('../worker/main.ts', import.meta.url).pathname
const ORIGIN = 'http://localhost:4100'

function manifest(
  database: Record<string, unknown>,
  applications: string[],
): ResolvedManifest {
  return defaultRegistry().resolve(
    parseManifest(authored(database, applications)),
  )
}

function authored(
  database: Record<string, unknown>,
  applications: string[],
) {
  return {
    bootstrap: {
      users: [{ email: 'root@example.com', name: 'Root', role: 'admin' }],
    },
    auth: {
      baseURL: ORIGIN,
      secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
      database: { url: { env: 'DATABASE' }, ...database },
      emailAndPassword: { enabled: true },
      applications: applications.map((id) => ({
        kind: 'first-party',
        id,
        origin: `http://${id}.localhost:3000`,
      })),
      session: {
        introspectionURL: `${ORIGIN}/api/auth/get-session`,
        issuer: 'e2e',
        claims: ['email', 'name'],
      },
    },
  }
}

/** A worker that dies at once, standing in for a manifest that breaks Better Auth. */
class BrokenNext implements Workers {
  broken = false
  constructor(private readonly inner: Workers) {}

  async start(resolved: ResolvedManifest) {
    if (!this.broken) return await this.inner.start(resolved)
    this.broken = false
    const process = ManagedProcess.start({
      command: Deno.execPath(),
      args: ['eval', 'console.error("cannot start"); Deno.exit(1)'],
      label: 'broken',
    })
    return {
      id: 'broken',
      upstream: 'http://127.0.0.1:1',
      get alive() {
        return process.alive
      },
      get output() {
        return process.output
      },
      exited: process.exited.then(() => {}),
      stop: async () => {
        await process.stop(100)
      },
    }
  }
}

async function scenario(
  storeLocation: string,
  database: Record<string, unknown>,
  databaseUrl: string,
) {
  const dir = Deno.makeTempDirSync()
  const values: Record<string, string> = {
    AUTH_SECRET: 'end-to-end-secret-with-plenty-of-entropy-0001',
    DATABASE: databaseUrl,
  }
  let broken: BrokenNext | undefined
  const runtime = await createRuntime({
    store: storeLocation,
    artifactsDirectory: `${dir}/artifacts`,
    workerEntry: WORKER,
    workerEnv: values,
    secrets: { env: (name) => values[name], readFile: Deno.readTextFileSync },
    deployment: {
      health: { timeoutMs: 20_000, intervalMs: 100 },
      drainMs: 2_000,
    },
    wrapWorkers: (workers) => (broken = new BrokenNext(workers)),
  })
  const port = freePort()
  const server = runtime.proxy.serve({ port, hostname: '127.0.0.1' })
  const url = (path: string) => `http://127.0.0.1:${port}${path}`
  const admin = { author: 'e2e' }
  try {
    // Revision 1: nothing exists yet, Better Auth's tables are created.
    const first = await runtime.deployment.apply(
      await runtime.deployment.plan(
        manifest(database, ['dashboard']),
        authored(database, ['dashboard']),
      ),
      admin,
    )
    assert(first.changed)
    await runtime.bootstrap.run()
    const control = new ControlService(runtime, runtime.events)
    const call = async (name: string, body: unknown) => {
      const result = await control.handle(name, body, admin)
      assertEquals(result.status, 200, JSON.stringify(result.body))
      // deno-lint-ignore no-explicit-any
      return result.body as any
    }

    const signUp = await fetch(url('/api/auth/sign-up/email'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'a-long-enough-password',
        name: 'Ada',
      }),
    })
    assertEquals(signUp.status, 200, await signUp.clone().text())
    await signUp.body?.cancel()
    let session = signUp.headers.getSetCookie()
      .map((c) => c.split(';')[0]).join('; ')
    const sessionEmail = async () => {
      const response = await fetch(url('/api/auth/get-session'), {
        headers: { cookie: session },
      })
      return (await response.json())?.user?.email
    }
    assertEquals(await sessionEmail(), 'ada@example.com')

    // Identity administration runs through the serving worker's Better Auth.
    const listed = await call('users.list', {})
    assertEquals(
      (listed.users as { email: string; role: string }[])
        .map((u) => [u.email, u.role]),
      [['ada@example.com', 'user'], ['root@example.com', 'admin']],
    )
    await call('users.ban', { user: 'ada@example.com', reason: 'spam' })
    assertEquals(await sessionEmail(), undefined, 'a ban signs the user out')
    const signIn = await fetch(url('/api/auth/sign-in/email'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'a-long-enough-password',
      }),
    })
    assertEquals(signIn.status, 403, 'a banned user cannot sign in')
    await signIn.body?.cancel()
    await call('users.unban', { user: 'ada@example.com' })
    const again = await fetch(url('/api/auth/sign-in/email'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'a-long-enough-password',
      }),
    })
    assertEquals(again.status, 200)
    await again.body?.cancel()
    session = again.headers.getSetCookie()
      .map((c) => c.split(';')[0]).join('; ')
    const cookie = session

    // Revision 2 swaps workers while requests keep flowing.
    let failures = 0
    let requests = 0
    let running = true
    const traffic = (async () => {
      while (running) {
        try {
          const response = await fetch(url('/api/auth/get-session'), {
            headers: { cookie },
          })
          const body = await response.json()
          requests += 1
          if (
            response.status !== 200 || body?.user?.email !== 'ada@example.com'
          ) {
            failures += 1
          }
        } catch {
          failures += 1
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    })()
    const before = runtime.proxy.upstream
    const second = await runtime.deployment.apply(
      await runtime.deployment.plan(
        manifest(database, ['dashboard', 'admin']),
      ),
      admin,
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    running = false
    await traffic
    assert(second.changed)
    assert(runtime.proxy.upstream !== before, 'traffic moved to the new worker')
    assertEquals(second.revision.parent, first.revision.id)
    assert(requests > 10, `only ${requests} requests ran during the swap`)
    assertEquals(failures, 0, 'no request failed during the swap')
    assertEquals(await sessionEmail(), 'ada@example.com', 'session survives')

    // The admin surface moved with the traffic to the new worker.
    const promoted = await call('users.setRole', {
      user: 'ada@example.com',
      role: 'admin',
    }) as { user: { id: string; role: string } }
    assertEquals(promoted.user.role, 'admin')
    const { entries } = await call('audit.list', {}) as {
      entries: { actor: string; action: string; target?: string }[]
    }
    assertEquals(
      entries.map((e) => [e.actor, e.action]),
      [
        ['e2e', 'users.setRole'],
        ['e2e', 'users.unban'],
        ['e2e', 'users.ban'],
        ['khatm', 'users.create'],
      ],
    )
    assertEquals(entries[0].target, promoted.user.id)

    // doctor sees the running installation, and a guard that drifted from the contract.
    const { findings } = await call('khatm.doctor', {
      guards: [{
        name: 'places',
        manifest: {
          authentication: [{
            scheme: 'session-cookie',
            session_url: `${ORIGIN}/api/auth/get-session`,
            issuer: 'e2e',
            claims: ['email', 'tenant'],
            cookie: 'better-auth.session_token',
          }],
        },
      }],
    }) as { findings: { check: string; severity: string }[] }
    assertEquals(
      findings.filter((f) => f.severity !== 'info')
        .map((f) => `${f.severity} ${f.check}`),
      [
        'ok base-url',
        // The apps are on *.localhost with no cookie domain: true, and worth saying.
        'warn cookie-domain',
        'warn cookie-domain',
        'ok secrets',
        'ok database',
        'ok worker',
        'warn public-url',
        'fail guard:places',
      ],
    )

    // A worker that will not start leaves revision 2 serving.
    const servingBefore = runtime.proxy.upstream
    broken!.broken = true
    const third = await runtime.deployment.plan(
      manifest(database, ['dashboard', 'admin', 'extra']),
    )
    await assertRejects(
      () => runtime.deployment.apply(third, admin),
      UnhealthyWorkerError,
    )
    assertEquals(runtime.proxy.upstream, servingBefore)
    assertEquals(await sessionEmail(), 'ada@example.com')
    assertEquals(
      (await runtime.store.active())?.revision.id,
      second.revision.id,
    )

    // The plan is stale once anything else was applied.
    const stale = await runtime.deployment.plan(
      manifest(database, ['dashboard', 'admin', 'x']),
    )
    await runtime.deployment.apply(
      await runtime.deployment.plan(manifest(database, ['dashboard', 'y'])),
      admin,
    )
    await assertRejects(() => runtime.deployment.apply(stale, admin))
    assertEquals((await runtime.store.history()).length, 3)
    assertEquals(
      Deno.readLinkSync(`${dir}/artifacts/current`),
      (await runtime.store.active())?.revision.id,
    )
    assert(
      Deno.statSync(
        `${dir}/artifacts/${first.revision.id}/manifest.json`,
      ).isFile,
    )
  } finally {
    await server.shutdown()
    await runtime.close()
    Deno.removeSync(dir, { recursive: true })
  }
}

Deno.test('e2e (sqlite): apply, swap without dropping requests, survive a bad apply', async () => {
  const dir = Deno.makeTempDirSync()
  try {
    await scenario(
      `${dir}/orchestrator.db`,
      { dialect: 'sqlite' },
      `${dir}/auth.db`,
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test({
  name: 'e2e (postgres): the same scenario in the khatm and auth schemas',
  ignore: !POSTGRES,
  fn: async () => {
    const admin = openSql(POSTGRES!)
    await admin.execute('DROP SCHEMA IF EXISTS khatm CASCADE')
    await admin.execute('DROP SCHEMA IF EXISTS auth_e2e CASCADE')
    await admin.close()
    await scenario(
      POSTGRES!,
      { dialect: 'postgres', schema: 'auth_e2e' },
      POSTGRES!,
    )
  },
})
