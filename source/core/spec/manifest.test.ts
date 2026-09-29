import { assertEquals, assertMatch, assertThrows } from '@std/assert'
import { authored, manifest } from './test-fixtures.ts'
import { InvalidManifestError, parseManifest } from './manifest.ts'
import { secretRefs } from './secret.ts'

function problemsOf(input: unknown): string[] {
  return assertThrows(() => parseManifest(input), InvalidManifestError)
    .problems
}

Deno.test('parseManifest: fills defaults', () => {
  const parsed = manifest()
  assertEquals(parsed.auth.plugins, [])
  assertEquals(parsed.auth.hooks, [])
  assertEquals(parsed.auth.socialProviders, {})
  assertEquals(parsed.branding, { tokens: {}, messages: {} })
})

Deno.test('parseManifest: an origin must be exact', () => {
  for (
    const origin of [
      'https://dashboard.example.com/app',
      'https://*.example.com',
      'ftp://dashboard.example.com',
    ]
  ) {
    const problems = problemsOf(authored({
      auth: {
        applications: [{ kind: 'first-party', id: 'dashboard', origin }],
      },
    }))
    assertMatch(
      problems[0],
      /^auth\.applications\.0\.origin: Must be an exact origin/,
    )
  }
})

Deno.test('parseManifest: application ids and origins are unique', () => {
  const app = {
    kind: 'first-party',
    id: 'dashboard',
    origin: 'https://dashboard.example.com',
  }
  const problems = problemsOf(authored({ auth: { applications: [app, app] } }))
  assertEquals(problems, [
    'auth.applications.1.id: Application id "dashboard" is declared twice',
    'auth.applications.1.origin: Origin https://dashboard.example.com belongs to two applications',
  ])
})

Deno.test('parseManifest: at most one landing application', () => {
  const problems = problemsOf(authored({
    auth: {
      applications: [
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.example.com',
          landing: true,
        },
        {
          kind: 'first-party',
          id: 'admin',
          origin: 'https://admin.example.com',
          landing: true,
        },
      ],
    },
  }))
  assertEquals(problems, [
    'auth.applications: At most one first-party application can be the landing app',
  ])
})

Deno.test('parseManifest: every cookie-sharing host lives under the cookie domain', () => {
  const problems = problemsOf(authored({
    auth: {
      baseURL: 'https://auth.other.org',
      applications: [
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.other.org',
        },
      ],
    },
  }))
  assertEquals(problems, [
    'auth.baseURL: https://auth.other.org is outside the cookie domain example.com',
    'auth.applications.0.origin: https://dashboard.other.org is outside the cookie domain example.com',
  ])
})

Deno.test('parseManifest: only Postgres and MSSQL take a schema', () => {
  const problems = problemsOf(authored({
    auth: {
      database: {
        dialect: 'sqlite',
        url: { file: '/data/auth.db' },
        schema: 'auth',
      },
    },
  }))
  assertEquals(problems, [
    'auth.database.schema: sqlite has no separate schemas',
  ])
})

Deno.test('parseManifest: secret versions are unique and there is at least one', () => {
  const ref = { env: 'AUTH_SECRET' }
  assertEquals(
    problemsOf(authored({
      auth: {
        secrets: [{ version: 1, value: ref }, { version: 1, value: ref }],
      },
    })),
    ['auth.secrets.1.version: Secret version 1 is declared twice'],
  )
  assertMatch(
    problemsOf(authored({ auth: { secrets: [] } }))[0],
    /^auth\.secrets:/,
  )
})

Deno.test('parseManifest: rejects unknown fields instead of ignoring them', () => {
  const problems = problemsOf(authored({ auth: { trustedOrigins: [] } }))
  assertMatch(problems[0], /trustedOrigins/)
})

Deno.test('secretRefs: lists signing secrets, database and provider credentials', () => {
  const parsed = manifest({
    auth: {
      socialProviders: {
        github: {
          clientId: { env: 'GH_ID' },
          clientSecret: { env: 'GH_SECRET' },
        },
      },
    },
  })
  assertEquals(secretRefs(parsed.auth), [
    { env: 'AUTH_SECRET' },
    { env: 'DATABASE_URL' },
    { env: 'GH_ID' },
    { env: 'GH_SECRET' },
  ])
})
