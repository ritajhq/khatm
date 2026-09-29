import { assert, assertEquals, assertRejects } from '@std/assert'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest, Revision } from '@khatm/spec'
import { StaleBaseError } from '@khatm/deployment'
import { openSql, type SqlClient } from './sql.ts'
import {
  installationKey,
  migrateStore,
  SqlApplyLock,
  SqlRevisionStore,
} from './stores.ts'

const POSTGRES = Deno.env.get('KHATM_TEST_POSTGRES')

const resolved = defaultRegistry().resolve(parseManifest({
  auth: {
    baseURL: 'https://auth.example.com',
    secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
    database: { dialect: 'sqlite', url: { env: 'DATABASE_URL' } },
    applications: [{
      kind: 'first-party',
      id: 'dashboard',
      origin: 'https://dashboard.example.com',
    }],
    session: {
      introspectionURL: 'http://auth:4100/api/auth/get-session',
      issuer: 'example',
      claims: ['email'],
    },
  },
}))

function state(parent?: string) {
  return {
    revision: Revision.create({
      parent,
      manifest: `sha256:${'a'.repeat(64)}`,
      author: 'ali',
      reason: 'test',
    }),
    resolved,
    fingerprints: { 'env:AUTH_SECRET': 'fp' },
  }
}

async function withClients(
  run: (open: () => SqlClient, name: string) => Promise<void>,
) {
  const dir = Deno.makeTempDirSync()
  try {
    await run(() => openSql(`${dir}/store.db`), 'sqlite')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
  if (POSTGRES) {
    const admin = openSql(POSTGRES)
    await admin.execute('DROP SCHEMA IF EXISTS khatm CASCADE')
    await admin.close()
    await run(() => openSql(POSTGRES), 'postgres')
  }
}

Deno.test('SqlRevisionStore: records, finds and swaps the active revision', async () => {
  await withClients(async (open, name) => {
    const client = open()
    await migrateStore(client)
    await migrateStore(client)
    const store = new SqlRevisionStore(client)
    assertEquals(await store.active(), undefined, name)

    const first = state()
    await store.activate(first, undefined)
    assertEquals((await store.active())?.revision, first.revision, name)
    assertEquals((await store.active())?.resolved, resolved, name)
    assertEquals((await store.active())?.fingerprints, first.fingerprints, name)

    // Someone else already moved past `undefined`.
    await assertRejects(
      () => store.activate(state(), undefined),
      StaleBaseError,
    )

    const second = state(first.revision.id)
    await store.activate(second, first.revision.id)
    assertEquals(
      (await store.find(first.revision.id))?.revision,
      first.revision,
    )
    assertEquals(
      (await store.history()).map((r) => r.id),
      [second.revision.id, first.revision.id],
      name,
    )
    await assertRejects(
      () => store.activate(state(), first.revision.id),
      StaleBaseError,
    )
    assertEquals((await store.active())?.revision.id, second.revision.id, name)
    await client.close()
  })
})

Deno.test('installationKey: made once, then stable', async () => {
  await withClients(async (open) => {
    const client = open()
    await migrateStore(client)
    const key = await installationKey(client)
    assert(key.length >= 64)
    assertEquals(await installationKey(client), key)
    await client.close()
  })
})

Deno.test('SqlApplyLock: one holder at a time, expired leases are taken over', async () => {
  await withClients(async (open, name) => {
    const a = open()
    const b = open()
    await migrateStore(a)
    let now = 1_000
    const lockA = new SqlApplyLock(a, { ttlMs: 100, now: () => now })
    const lockB = new SqlApplyLock(b, { ttlMs: 100, now: () => now })

    const held = await lockA.acquire('a')
    assert(held, name)
    assertEquals(await lockB.acquire('b'), undefined, name)
    await held.release()

    const again = await lockB.acquire('b')
    assert(again, name)
    assertEquals(await lockA.acquire('a'), undefined, name)

    // A holder that never releases (crashed) loses the lock when it expires.
    now += 500
    const takenOver = await lockA.acquire('a')
    assert(takenOver, name)
    await again.release() // the old holder's release must not free the new lease
    assertEquals(await lockB.acquire('b'), undefined, name)
    await takenOver.release()
    await a.close()
    await b.close()
  })
})
