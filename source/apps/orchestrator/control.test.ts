import { assert, assertEquals, assertRejects } from '@std/assert'
import { Client, ControlError } from '@khatm/client'
import {
  Deployment,
  FakeMigrator,
  fakeProbe,
  FakeSecrets,
  FakeWorkers,
  MemoryArtifacts,
  MemoryLock,
  RecordingTraffic,
} from '@khatm/deployment'
import { SwitchableProxy } from '@khatm-libs/supervisor'
import { ControlService, EventLog, serveControl } from './control.ts'
import { Bundles } from './bundles.ts'
import { openSql } from './sql.ts'
import { migrateStore, SqlRevisionStore } from './stores.ts'

function manifest(applications: string[] = ['dashboard']) {
  return {
    auth: {
      baseURL: 'https://auth.example.com',
      secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
      database: { dialect: 'sqlite', url: { env: 'DATABASE_URL' } },
      emailAndPassword: { enabled: true },
      applications: applications.map((id) => ({
        kind: 'first-party',
        id,
        origin: `https://${id}.example.com`,
      })),
      session: {
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'example',
        claims: ['email', 'name'],
      },
    },
  }
}

async function setup() {
  const dir = Deno.makeTempDirSync()
  const sql = openSql(`${dir}/store.db`)
  await migrateStore(sql)
  const store = new SqlRevisionStore(sql)
  const workers = new FakeWorkers()
  const log = new EventLog()
  const secrets = new FakeSecrets({
    'env:AUTH_SECRET': 's',
    'env:DATABASE_URL': 'db',
  })
  const migrator = new FakeMigrator()
  const deployment = new Deployment({
    store,
    lock: new MemoryLock(),
    workers,
    traffic: new RecordingTraffic(),
    migrator,
    secrets,
    artifacts: new MemoryArtifacts(),
    events: log,
  }, {
    health: { probe: fakeProbe(workers), timeoutMs: 100, intervalMs: 5 },
    drainMs: 0,
  })
  const service = new ControlService(
    {
      deployment,
      store,
      proxy: new SwitchableProxy(),
      bundles: new Bundles(store, undefined),
    },
    log,
  )
  const socket = `${dir}/control.sock`
  const server = serveControl(service, { socket })
  const client = new Client({ socket })
  return {
    client,
    api: client.api,
    migrator,
    secrets,
    socket,
    service,
    async close() {
      client.close()
      await server.shutdown()
      await deployment.shutdown()
      sql.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

Deno.test('control: plan, apply, status and history over the Unix socket', async () => {
  const t = await setup()
  try {
    const first = await t.api.plan({ manifest: manifest() })
    assertEquals(first.base, undefined)
    assert(!first.isEmpty)

    const applied = await t.api.apply({
      manifest: manifest(),
      base: first.base,
    })
    assert(applied.changed)
    assertEquals(applied.revision.author, 'socket')

    const status = await t.api.status({})
    assertEquals(status.active?.id, applied.revision.id)

    const second = await t.api.plan({
      manifest: manifest(['dashboard', 'admin']),
    })
    assertEquals(second.base, applied.revision.id)
    assertEquals(second.impact, 'restart')
    const again = await t.api.apply({
      manifest: manifest(['dashboard', 'admin']),
      base: second.base,
    })
    assertEquals(again.revision.parent, applied.revision.id)

    const history = await t.api.history({})
    assertEquals(history.revisions.map((r) => r.id), [
      again.revision.id,
      applied.revision.id,
    ])
    const back = await t.api.rollback({ revision: applied.revision.id })
    assertEquals(back.revision.manifest, applied.revision.manifest)

    const exported = await t.api.export({ revision: applied.revision.id })
    assertEquals(exported.revision.id, applied.revision.id)
    assertEquals(
      JSON.parse(exported.files['manifest.authored.json']).auth.baseURL,
      'https://auth.example.com',
    )
    assertEquals(
      (await t.api.export({})).revision.id,
      back.revision.id,
    )

    const events = await t.api.events({ limit: 3 })
    assertEquals(events.events.length, 3)
  } finally {
    await t.close()
  }
})

Deno.test('control: errors say what to do', async () => {
  const t = await setup()
  try {
    const rejected = async (run: () => Promise<unknown>, code: string) => {
      const error = await assertRejects(run, ControlError)
      assertEquals(error.code, code)
      return error
    }
    await rejected(
      () => t.api.plan({ manifest: { auth: { nonsense: true } } }),
      'invalid_manifest',
    )

    const first = await t.api.apply({ manifest: manifest() })
    await rejected(
      () =>
        t.api.apply({
          manifest: manifest(['dashboard', 'admin']),
          base: 'not-the-active-revision',
        }),
      'stale_plan',
    )

    t.secrets.values['env:AUTH_SECRET'] = 'rotated'
    const destructive = await rejected(
      () => t.api.apply({ manifest: manifest() }),
      'confirmation_required',
    )
    assertEquals(destructive.body.steps?.[0].impact, 'destructive')
    const confirmed = await t.api.apply({
      manifest: manifest(),
      confirmed: true,
    })
    assert(confirmed.changed)

    await rejected(
      () => t.api.rollback({ revision: 'nope' }),
      'unknown_revision',
    )
    assert(first.changed)
  } finally {
    await t.close()
  }
})

Deno.test('control: the TCP port trusts only the guard-supplied subject', async () => {
  const t = await setup()
  const server = serveControl(t.service, { port: 0, hostname: '127.0.0.1' })
  const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`
  try {
    const anonymous = new Client({ url })
    const error = await assertRejects(
      () => anonymous.api.status({}),
      ControlError,
    )
    assertEquals(error.code, 'unauthenticated')
    assertEquals(error.status, 401)

    const guarded = new Client({ url, headers: { 'x-idhn-subject': 'ada' } })
    const applied = await guarded.api.apply({ manifest: manifest() })
    assertEquals(applied.revision.author, 'ada')

    const bad = await fetch(`${url}/khatm.status`, {
      method: 'POST',
      headers: { 'x-idhn-subject': 'ada' },
      body: 'not json',
    })
    assertEquals(bad.status, 400)
    await bad.body?.cancel()
    const missing = await fetch(`${url}/khatm.nothing`, {
      method: 'POST',
      headers: { 'x-idhn-subject': 'ada' },
      body: '{}',
    })
    assertEquals(missing.status, 404)
    await missing.body?.cancel()
  } finally {
    await server.shutdown()
    await t.close()
  }
})
