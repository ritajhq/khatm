import { assertEquals, assertRejects } from '@std/assert'
import { SERVICE_USER } from '@khatm/spec'
import {
  Administration,
  AdminRejectedError,
  ProtectedUserError,
  UnknownUserError,
} from './administration.ts'
import { type Auth, createAuth } from './create-auth.ts'
import { runMigrations } from './migrations.ts'
import {
  fakeSource,
  resolvedSqlite,
  secretValues,
  sessionOf,
  signUp,
} from './test-support.ts'

async function withAdministration(
  run: (admin: Administration, auth: Auth) => Promise<void>,
  secrets: { version: number; value: { env: string } }[] = [
    { version: 1, value: { env: 'AUTH_SECRET_1' } },
  ],
): Promise<void> {
  const dir = Deno.makeTempDirSync({ prefix: 'khatm-admin-' })
  const source = fakeSource(secretValues(`${dir}/auth.db`))
  const resolved = resolvedSqlite({ secrets })
  await runMigrations(resolved, source)
  const { auth, close } = createAuth(resolved, source, { quiet: true })
  try {
    const admin = new Administration(auth)
    await admin.ensureServiceUser()
    await run(admin, auth)
  } finally {
    await close()
    Deno.removeSync(dir, { recursive: true })
  }
}

Deno.test('Administration: the service user exists once, has no account and is never listed', async () => {
  await withAdministration(async (admin, auth) => {
    await admin.ensureServiceUser()
    await signUp(auth, 'ada@example.com')
    const { users, total } = await admin.list({})
    assertEquals(users.map((u) => u.email), ['ada@example.com'])
    assertEquals(total, 1)
    assertEquals(await admin.lookup([SERVICE_USER.id]), [])
    await assertRejects(() => admin.get(SERVICE_USER.id), ProtectedUserError)
    await assertRejects(
      () => admin.ban(SERVICE_USER.email, {}),
      ProtectedUserError,
    )
    const context = await auth.$context
    assertEquals(
      await context.internalAdapter.findAccounts(SERVICE_USER.id),
      [],
    )
  })
})

Deno.test('Administration: banning revokes sessions and blocks sign-in until unbanned', async () => {
  await withAdministration(async (admin, auth) => {
    const cookie = await signUp(auth, 'ada@example.com')
    const detail = await admin.get('ada@example.com')
    assertEquals(detail.sessions.length, 1)
    assertEquals(detail.accounts.map((a) => a.providerId), ['credential'])

    const banned = await admin.ban('ada@example.com', { reason: 'spam' })
    assertEquals([banned.banned, banned.banReason], [true, 'spam'])
    assertEquals(await sessionOf(auth, cookie), null)

    const unbanned = await admin.unban(banned.id)
    assertEquals(unbanned.banned, false)
    // khatm's own per-call sessions are gone again.
    const context = await auth.$context
    assertEquals(
      await context.internalAdapter.listSessions(SERVICE_USER.id),
      [],
    )
  })
})

Deno.test('Administration: role, verification, password, sessions and removal go through Better Auth', async () => {
  await withAdministration(async (admin, auth) => {
    const first = await signUp(auth, 'ada@example.com')
    await signUp(auth, 'bob@example.com')
    assertEquals(
      (await admin.setRole('ada@example.com', 'admin')).role,
      'admin',
    )
    assertEquals(
      (await admin.verifyEmail('ada@example.com')).emailVerified,
      true,
    )
    await assertRejects(
      () => admin.setPassword('ada@example.com', 'short'),
      AdminRejectedError,
    )
    await admin.setPassword('ada@example.com', 'another-long-password')

    const { sessions } = await admin.get('ada@example.com')
    assertEquals(
      await admin.revokeSessions('ada@example.com', sessions[0].id),
      1,
    )
    assertEquals(await sessionOf(auth, first), null)
    assertEquals(await admin.revokeSessions('ada@example.com', 'nope'), 0)

    const created = await admin.create({
      email: 'cy@example.com',
      name: 'Cy',
      role: 'user',
    })
    assertEquals(
      (await admin.list({ search: 'example.com' })).users.map((u) => u.email),
      ['cy@example.com', 'bob@example.com', 'ada@example.com'],
    )
    assertEquals((await admin.list({ search: 'bob' })).total, 1)
    assertEquals(
      (await admin.lookup([created.id, 'missing'])).map((u) => u.email),
      ['cy@example.com'],
    )
    await admin.remove(created.id)
    await assertRejects(() => admin.get(created.id), UnknownUserError)
  })
})

Deno.test('Administration: signs its sessions with the newest secret version', async () => {
  await withAdministration(
    async (admin, auth) => {
      await signUp(auth, 'ada@example.com')
      assertEquals((await admin.list({})).total, 1)
    },
    [
      { version: 1, value: { env: 'AUTH_SECRET_1' } },
      { version: 2, value: { env: 'AUTH_SECRET_2' } },
    ],
  )
})
