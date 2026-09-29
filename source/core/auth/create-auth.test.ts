import { assertEquals, assertThrows } from '@std/assert'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest } from '@khatm/spec'
import { createAuth, UnknownCapabilityError } from './create-auth.ts'
import { planMigrations, runMigrations } from './migrations.ts'
import {
  BASE_URL,
  fakeSource,
  resolvedSqlite,
  secretValues,
  sessionOf,
  signUp,
} from './test-support.ts'

function tempDatabase(): { path: string; cleanup(): void } {
  const dir = Deno.makeTempDirSync({ prefix: 'khatm-auth-' })
  return {
    path: `${dir}/auth.db`,
    cleanup: () => Deno.removeSync(dir, { recursive: true }),
  }
}

Deno.test("migrations: an empty database needs Better Auth's four tables, then nothing", async () => {
  const db = tempDatabase()
  try {
    const source = fakeSource(secretValues(db.path))
    const resolved = resolvedSqlite()
    assertEquals((await planMigrations(resolved, source)).created, [
      'user',
      'session',
      'account',
      'verification',
    ])
    await runMigrations(resolved, source)
    assertEquals(await planMigrations(resolved, source), {
      created: [],
      added: [],
      unsafe: [],
    })
  } finally {
    db.cleanup()
  }
})

Deno.test('migrations: adding a plugin only adds, and the plan says what', async () => {
  const db = tempDatabase()
  try {
    const source = fakeSource(secretValues(db.path))
    await runMigrations(resolvedSqlite(), source)

    const withUsername = resolvedSqlite({ plugins: [{ kind: 'username' }] })
    const plan = await planMigrations(withUsername, source)
    assertEquals(plan.created, [])
    assertEquals(plan.added, [{
      table: 'user',
      fields: ['username', 'displayUsername'],
    }])
    assertEquals(plan.unsafe, [])

    await runMigrations(withUsername, source)
    // The plugin-less version keeps working against the wider schema.
    const old = createAuth(resolvedSqlite(), source, { quiet: true })
    try {
      await signUp(old.auth)
    } finally {
      await old.close()
    }
  } finally {
    db.cleanup()
  }
})

Deno.test('createAuth: signs up, then recognizes the session', async () => {
  const db = tempDatabase()
  const source = fakeSource(secretValues(db.path))
  try {
    await runMigrations(resolvedSqlite(), source)
    const { auth, close } = createAuth(resolvedSqlite(), source, {
      quiet: true,
    })
    try {
      const cookie = await signUp(auth)
      assertEquals(
        (await sessionOf(auth, cookie))?.user.email,
        'ada@example.com',
      )
      assertEquals(await sessionOf(auth, ''), null)
    } finally {
      await close()
    }
  } finally {
    db.cleanup()
  }
})

Deno.test('createAuth: derived plugins are built too (role claim brings the admin plugin)', async () => {
  const db = tempDatabase()
  const source = fakeSource(secretValues(db.path))
  try {
    const withRole = resolvedSqlite({
      session: {
        introspectionURL: 'http://localhost:4100/api/auth/get-session',
        issuer: 'test',
        claims: ['email', 'role'],
      },
    })
    await runMigrations(withRole, source)
    const { auth, close } = createAuth(withRole, source, { quiet: true })
    try {
      const cookie = await signUp(auth)
      const session = await sessionOf(auth, cookie) as {
        user: { role?: string }
      }
      assertEquals(session.user.role, 'user')
    } finally {
      await close()
    }
  } finally {
    db.cleanup()
  }
})

Deno.test('createAuth: only the newest secret version verifies session cookies', async () => {
  const db = tempDatabase()
  const source = fakeSource(secretValues(db.path))
  const only1 = resolvedSqlite()
  const both = resolvedSqlite({
    secrets: [
      { version: 1, value: { env: 'AUTH_SECRET_1' } },
      { version: 2, value: { env: 'AUTH_SECRET_2' } },
    ],
  })
  const only2 = resolvedSqlite({
    secrets: [{ version: 2, value: { env: 'AUTH_SECRET_2' } }],
  })
  try {
    await runMigrations(only1, source)
    let cookie: string
    {
      const { auth, close } = createAuth(only2, source, { quiet: true })
      cookie = await signUp(auth)
      await close()
    }
    for (
      const [name, resolved, expected] of [
        ['older version added', both, 'ada@example.com'],
        ['newest version dropped', only1, undefined],
      ] as const
    ) {
      const { auth, close } = createAuth(resolved, source, { quiet: true })
      try {
        assertEquals(
          (await sessionOf(auth, cookie))?.user.email,
          expected,
          name,
        )
      } finally {
        await close()
      }
    }
  } finally {
    db.cleanup()
  }
})

Deno.test('createAuth: capability hooks are refused until the registry has them', () => {
  const resolved = defaultRegistry().resolve(parseManifest({
    auth: {
      ...resolvedSqlite().auth,
      hooks: [{ name: 'email.smtp' }],
    },
  }))
  assertThrows(
    () => createAuth(resolved, fakeSource(secretValues('/tmp/x.db'))),
    UnknownCapabilityError,
  )
  void BASE_URL
})
