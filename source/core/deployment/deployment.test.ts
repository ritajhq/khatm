import { assert, assertEquals, assertRejects } from '@std/assert'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest, type ResolvedManifest } from '@khatm/spec'
import {
  ApplyInProgressError,
  BlockedPlanError,
  ConfirmationRequiredError,
  Deployment,
  StalePlanError,
  UnhealthyWorkerError,
} from './deployment.ts'
import { checkOnce } from './health.ts'
import {
  FakeMigrator,
  fakeProbe,
  FakeSecrets,
  FakeWorkers,
  MemoryArtifacts,
  MemoryLock,
  MemoryRevisionStore,
  RecordingEvents,
  RecordingTraffic,
} from './fakes.ts'

function resolved(
  auth: Record<string, unknown> = {},
  branding?: Record<string, unknown>,
): ResolvedManifest {
  return defaultRegistry().resolve(parseManifest({
    auth: {
      baseURL: 'https://auth.example.com',
      secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
      database: { dialect: 'sqlite', url: { env: 'DATABASE_URL' } },
      emailAndPassword: { enabled: true },
      applications: [{
        kind: 'first-party',
        id: 'dashboard',
        origin: 'https://dashboard.example.com',
      }],
      session: {
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'example',
        claims: ['email', 'name'],
      },
      ...auth,
    },
    ...(branding ? { branding } : {}),
  }))
}

/** Same manifest plus one more application: a restart-level change. */
function variant(n: number): ResolvedManifest {
  return resolved({
    applications: [
      {
        kind: 'first-party',
        id: 'dashboard',
        origin: 'https://dashboard.example.com',
      },
      {
        kind: 'first-party',
        id: `app${n}`,
        origin: `https://app${n}.example.com`,
      },
    ],
  })
}

function setup() {
  const store = new MemoryRevisionStore()
  const lock = new MemoryLock()
  const workers = new FakeWorkers()
  const traffic = new RecordingTraffic()
  const migrator = new FakeMigrator()
  const secrets = new FakeSecrets({
    'env:AUTH_SECRET': 's1',
    'env:DATABASE_URL': 'db',
    'env:AUTH_SECRET_2': 's2',
  })
  const artifacts = new MemoryArtifacts()
  const events = new RecordingEvents()
  const deployment = new Deployment(
    { store, lock, workers, traffic, migrator, secrets, artifacts, events },
    {
      health: {
        probe: fakeProbe(workers),
        timeoutMs: 50,
        intervalMs: 5,
      },
      drainMs: 0,
      restartDelaysMs: [0],
    },
  )
  return {
    store,
    lock,
    workers,
    traffic,
    migrator,
    secrets,
    artifacts,
    events,
    deployment,
  }
}

const admin = { author: 'ali' }

Deno.test('Deployment: the first apply starts a worker and records the revision', async () => {
  const t = setup()
  const planned = await t.deployment.plan(resolved())
  assertEquals(planned.base, undefined)
  const { revision, changed } = await t.deployment.apply(planned, admin)
  assert(changed)
  assertEquals(revision.parent, undefined)
  assertEquals(t.traffic.current, 'http://fake-1')
  assertEquals((await t.store.active())?.revision.id, revision.id)
  assertEquals(t.artifacts.written.length, 1)
  assertEquals(t.events.types, ['apply.started', 'apply.activated'])
  await t.deployment.shutdown()
})

Deno.test('Deployment: a second apply swaps blue/green, draining and stopping the old worker', async () => {
  const t = setup()
  const first = await t.deployment.apply(
    await t.deployment.plan(resolved()),
    admin,
  )
  const second = await t.deployment.apply(
    await t.deployment.plan(variant(10)),
    admin,
  )
  assertEquals(second.revision.parent, first.revision.id)
  assertEquals(t.traffic.switches, ['http://fake-1', 'http://fake-2'])
  assertEquals(t.traffic.drained, ['http://fake-1'])
  assertEquals(t.workers.started[0].alive, false)
  assertEquals(t.workers.started[1].alive, true)
  await t.deployment.shutdown()
})

Deno.test('Deployment: an unhealthy new worker leaves the old one serving', async () => {
  const t = setup()
  const first = await t.deployment.apply(
    await t.deployment.plan(resolved()),
    admin,
  )
  t.workers.script = [false]
  const planned = await t.deployment.plan(
    variant(5),
  )
  await assertRejects(
    () => t.deployment.apply(planned, admin),
    UnhealthyWorkerError,
  )
  assertEquals(t.traffic.current, 'http://fake-1')
  assertEquals((await t.store.active())?.revision.id, first.revision.id)
  assertEquals(t.workers.started[1].alive, false)
  assertEquals(t.workers.started[0].alive, true)
  assert(t.events.types.includes('apply.unhealthy'))
  await t.deployment.shutdown()
})

Deno.test('checkOnce: a worker that does not answer a trusted origin fails the preflight', async () => {
  const workers = new FakeWorkers()
  const worker = await workers.start(resolved())
  const other = new FakeWorkers()
  const foreign = await other.start(variant(1))
  // The worker only knows the origins of its own manifest.
  const probe = fakeProbe(workers)
  assertEquals(await checkOnce(worker, resolved(), probe), [])
  const failures = await checkOnce(
    worker,
    variant(1),
    (url, init) => probe(url, init),
  )
  assertEquals(failures.length, 1)
  assert(failures[0].startsWith('preflight https://app1.example.com'))
  await foreign.stop()
})

Deno.test('Deployment: only one apply runs at a time', async () => {
  const t = setup()
  const planned = await t.deployment.plan(resolved())
  const held = await t.lock.acquire('someone else')
  assert(held)
  await assertRejects(
    () => t.deployment.apply(planned, admin),
    ApplyInProgressError,
  )
  await held.release()
  await t.deployment.apply(planned, admin)
  await t.deployment.shutdown()
})

Deno.test('Deployment: a plan made against an older revision is refused', async () => {
  const t = setup()
  const stale = await t.deployment.plan(resolved())
  await t.deployment.apply(await t.deployment.plan(resolved()), admin)
  await assertRejects(() => t.deployment.apply(stale, admin), StalePlanError)
  await t.deployment.shutdown()
})

Deno.test('Deployment: destructive plans need confirmation', async () => {
  const t = setup()
  await t.deployment.apply(await t.deployment.plan(resolved()), admin)
  t.secrets.values['env:AUTH_SECRET'] = 'changed'
  const planned = await t.deployment.plan(resolved())
  assertEquals(planned.plan.impact, 'destructive')
  await assertRejects(
    () => t.deployment.apply(planned, admin),
    ConfirmationRequiredError,
  )
  const done = await t.deployment.apply(planned, { ...admin, confirmed: true })
  assert(done.changed)
  await t.deployment.shutdown()
})

Deno.test('Deployment: adding a newer secret version is destructive, an older one is not', async () => {
  const t = setup()
  await t.deployment.apply(await t.deployment.plan(resolved()), admin)
  const newer = await t.deployment.plan(resolved({
    secrets: [
      { version: 1, value: { env: 'AUTH_SECRET' } },
      { version: 2, value: { env: 'AUTH_SECRET_2' } },
    ],
  }))
  assertEquals(newer.plan.impact, 'destructive')
  await t.deployment.shutdown()
})

Deno.test('Deployment: adding an older secret version only restarts', async () => {
  const t = setup()
  const v2 = { version: 2, value: { env: 'AUTH_SECRET_2' } }
  await t.deployment.apply(
    await t.deployment.plan(resolved({ secrets: [v2] })),
    admin,
  )
  const older = await t.deployment.plan(resolved({
    secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }, v2],
  }))
  assertEquals(older.plan.impact, 'restart')
  await t.deployment.shutdown()
})

Deno.test('Deployment: additive migrations run before the new worker starts; unsafe ones block', async () => {
  const t = setup()
  t.migrator.pending = {
    created: ['organization'],
    added: [{ table: 'user', fields: ['role'] }],
    unsafe: [],
  }
  const planned = await t.deployment.plan(resolved())
  assertEquals(
    planned.plan.steps.filter((s) => s.impact === 'migration').map((s) =>
      s.path
    ),
    ['migration[organization]', 'migration[user]'],
  )
  await t.deployment.apply(planned, admin)
  assertEquals(t.migrator.runs.length, 1)
  assert(
    t.events.types.indexOf('apply.migrated') <
      t.events.types.indexOf('apply.activated'),
  )

  t.migrator.pending = { created: [], added: [], unsafe: ['drop column'] }
  const blocked = await t.deployment.plan(
    variant(1),
  )
  assert(blocked.plan.isBlocked)
  await assertRejects(
    () => t.deployment.apply(blocked, admin),
    BlockedPlanError,
  )
  await t.deployment.shutdown()
})

Deno.test('Deployment: when recording the switch fails, traffic goes back and the new worker stops', async () => {
  const t = setup()
  await t.deployment.apply(await t.deployment.plan(resolved()), admin)
  t.store.failNextActivate = true
  const planned = await t.deployment.plan(
    variant(3),
  )
  await assertRejects(
    () => t.deployment.apply(planned, admin),
    Error,
    'store unavailable',
  )
  assertEquals(t.traffic.current, 'http://fake-1')
  assertEquals(t.workers.started[1].alive, false)
  assertEquals(t.workers.started[0].alive, true)
  await t.deployment.shutdown()
})

Deno.test('Deployment: an empty plan changes nothing', async () => {
  const t = setup()
  const first = await t.deployment.apply(
    await t.deployment.plan(resolved()),
    admin,
  )
  const again = await t.deployment.apply(
    await t.deployment.plan(resolved()),
    admin,
  )
  assertEquals(again.changed, false)
  assertEquals(again.revision.id, first.revision.id)
  assertEquals(t.workers.started.length, 1)
  await t.deployment.shutdown()
})

Deno.test('Deployment: a rollback is a new revision pointing at the older manifest', async () => {
  const t = setup()
  const first = await t.deployment.apply(
    await t.deployment.plan(resolved()),
    admin,
  )
  await t.deployment.apply(
    await t.deployment.plan(variant(9)),
    admin,
  )
  const back = await t.deployment.apply(
    await t.deployment.planRollback(first.revision.id),
    admin,
  )
  assertEquals(back.revision.manifest, first.revision.manifest)
  assert(back.revision.id !== first.revision.id)
  await t.deployment.shutdown()
})

Deno.test('Deployment: boot serves the recorded revision; a crashed worker is restarted', async () => {
  const t = setup()
  await t.deployment.apply(await t.deployment.plan(resolved()), admin)
  await t.deployment.shutdown()

  const booted = setup()
  booted.store.history.push(...t.store.history)
  await booted.store.activate(t.store.history[0], undefined)
  assertEquals(await booted.deployment.boot(), t.store.history[0].revision)
  assertEquals(booted.traffic.current, 'http://fake-1')

  booted.workers.last.crash()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assertEquals(booted.traffic.current, 'http://fake-2')
  assert(booted.events.types.includes('worker.crashed'))
  assert(booted.events.types.includes('worker.restarted'))
  await booted.deployment.shutdown()
})
