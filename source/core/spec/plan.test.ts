import { assertEquals } from '@std/assert'
import { manifest } from './test-fixtures.ts'
import { plan, type PlanStep } from './plan.ts'
import { type Derivation, type Derived, digestOf, resolve } from './resolve.ts'

type Overrides = Parameters<typeof manifest>[0]

const adminFromRole: Derivation = {
  derive: (m): Record<string, Derived> =>
    m.auth.session.claims.includes('role')
      ? {
        'plugins.admin': {
          value: { kind: 'admin', options: {} },
          derivedFrom: 'auth.session.claims',
        },
      }
      : {},
}

function resolved(overrides: Overrides = {}) {
  return resolve(manifest(overrides), [adminFromRole])
}

function session(claims: string[]) {
  return {
    cookieDomain: 'example.com',
    introspectionURL: 'http://auth:4100/api/auth/get-session',
    issuer: 'example',
    claims,
  }
}

async function stepsBetween(
  before: Overrides,
  after: Overrides,
): Promise<Pick<PlanStep, 'path' | 'impact' | 'derivedFrom'>[]> {
  const result = await plan(resolved(before), resolved(after))
  return result.steps.map(({ path, impact, derivedFrom }) =>
    derivedFrom === undefined ? { path, impact } : { path, impact, derivedFrom }
  )
}

Deno.test('plan: nothing to do between equal manifests', async () => {
  const result = await plan(resolved(), resolved())
  assertEquals(result.isEmpty, true)
  assertEquals(result.impact, 'hot')
  assertEquals(result.base, result.desired)
})

Deno.test('plan: binds to the digests it was computed from', async () => {
  const [current, desired] = [
    resolved(),
    resolved({ branding: { tokens: { a: 'b' } } }),
  ]
  const result = await plan(current, desired)
  assertEquals(result.base, await digestOf(current))
  assertEquals(result.desired, await digestOf(desired))
})

Deno.test('plan: a first apply has no base and adds everything', async () => {
  const result = await plan(undefined, resolved())
  assertEquals(result.base, undefined)
  assertEquals(result.steps.every((step) => step.before === undefined), true)
})

Deno.test('plan: branding applies hot', async () => {
  assertEquals(
    await stepsBetween({}, { branding: { tokens: { primary: '#0a0' } } }),
    [{ path: 'branding.tokens.primary', impact: 'hot' }],
  )
})

Deno.test('plan: adding a plugin migrates, removing one is destructive', async () => {
  const withUsername = { auth: { plugins: [{ kind: 'username' }] } }
  assertEquals(await stepsBetween({}, withUsername), [
    { path: 'auth.plugins[username]', impact: 'migration' },
  ])
  assertEquals(await stepsBetween(withUsername, {}), [
    { path: 'auth.plugins[username]', impact: 'destructive' },
  ])
})

Deno.test('plan: a plugin option change is a restart', async () => {
  assertEquals(
    await stepsBetween(
      { auth: { plugins: [{ kind: 'username' }] } },
      {
        auth: {
          plugins: [{ kind: 'username', options: { minUsernameLength: 5 } }],
        },
      },
    ),
    [{
      path: 'auth.plugins[username].options.minUsernameLength',
      impact: 'restart',
    }],
  )
})

Deno.test('plan: adding a secret version rotates; dropping one is destructive', async () => {
  const one = [{ version: 1, value: { env: 'AUTH_SECRET' } }]
  const two = [...one, { version: 2, value: { env: 'AUTH_SECRET_2' } }]
  assertEquals(
    await stepsBetween({ auth: { secrets: one } }, { auth: { secrets: two } }),
    [
      { path: 'auth.secrets[2]', impact: 'restart' },
    ],
  )
  assertEquals(
    await stepsBetween({ auth: { secrets: two } }, { auth: { secrets: one } }),
    [
      { path: 'auth.secrets[2]', impact: 'destructive' },
    ],
  )
})

Deno.test('plan: a secret value changed behind the same ref is destructive', async () => {
  const result = await plan(resolved(), resolved(), {
    current: { 'env:AUTH_SECRET': 'fp-1' },
    desired: { 'env:AUTH_SECRET': 'fp-2' },
  })
  assertEquals(
    result.steps.map(({ path, impact }) => ({ path, impact })),
    [{ path: 'secret[env:AUTH_SECRET]', impact: 'destructive' }],
  )
  assertEquals(result.needsConfirmation, true)
})

Deno.test('plan: switching http and https is destructive, moving hosts is not', async () => {
  const http = {
    auth: { baseURL: 'http://auth.example.com' },
  }
  assertEquals(await stepsBetween({}, http), [
    { path: 'auth.baseURL', impact: 'destructive' },
  ])
  assertEquals(
    await stepsBetween({}, { auth: { baseURL: 'https://login.example.com' } }),
    [{ path: 'auth.baseURL', impact: 'restart' }],
  )
})

Deno.test('plan: dropping a claim breaks guards, adding one does not', async () => {
  assertEquals(
    await stepsBetween(
      { auth: { session: session(['email', 'name']) } },
      { auth: { session: session(['email', 'name', 'image']) } },
    ),
    [{ path: 'auth.session.claims', impact: 'restart' }],
  )
  assertEquals(
    await stepsBetween(
      { auth: { session: session(['email', 'name']) } },
      { auth: { session: session(['email']) } },
    ),
    [{ path: 'auth.session.claims', impact: 'destructive' }],
  )
})

Deno.test('plan: a derived change says what it was derived from', async () => {
  assertEquals(
    await stepsBetween(
      { auth: { session: session(['email', 'role']) } },
      { auth: { session: session(['email']) } },
    ),
    [
      { path: 'auth.session.claims', impact: 'destructive' },
      {
        path: 'derived[plugins.admin]',
        impact: 'destructive',
        derivedFrom: 'auth.session.claims',
      },
    ],
  )
})

Deno.test('plan: an application change is a restart', async () => {
  assertEquals(
    await stepsBetween({}, {
      auth: {
        applications: [
          {
            kind: 'first-party',
            id: 'dashboard',
            origin: 'https://dashboard.example.com',
          },
          {
            kind: 'first-party',
            id: 'admin',
            origin: 'https://admin.example.com',
          },
        ],
      },
    }),
    [{ path: 'auth.applications[admin]', impact: 'restart' }],
  )
})
