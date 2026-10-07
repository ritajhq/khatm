import { assertEquals, assertThrows } from '@std/assert'
import { parseManifest, Placement, UnplaceableManifestError } from '@khatm/spec'
import { defaultRegistry } from './registry.ts'
import { portal } from './test-fixtures.ts'

/** Portal written once for every environment: where it runs comes from the deployment. */
const anywhere = () =>
  portal({
    baseURL: { env: 'AUTH_BASE_URL' },
    applications: [
      {
        kind: 'first-party',
        id: 'dashboard',
        origin: { env: 'DASHBOARD_ORIGIN' },
        landing: true,
      },
      { kind: 'first-party', id: 'admin', origin: { env: 'ADMIN_ORIGIN' } },
    ],
    session: {
      cookieDomain: { env: 'AUTH_COOKIE_DOMAIN' },
      introspectionURL: 'http://auth:4100/api/auth/get-session',
      issuer: 'portal',
      claims: ['username', 'email', 'name', 'emailVerified', 'role'],
    },
  })

const development = new Placement((name) =>
  ({
    AUTH_BASE_URL: 'https://auth.lvh.me:8443',
    DASHBOARD_ORIGIN: 'https://dashboard.lvh.me:8443',
    ADMIN_ORIGIN: 'https://admin.lvh.me:8443',
    AUTH_COOKIE_DOMAIN: 'lvh.me',
  })[name]
)

Deno.test('place: references read from the deployment, and what derives from them derived again', () => {
  const registry = defaultRegistry()
  const placed = registry.place(registry.resolve(anywhere()), development)

  assertEquals(placed.auth.baseURL, 'https://auth.lvh.me:8443')
  assertEquals(placed.derived['trustedOrigins'].value, [
    'https://dashboard.lvh.me:8443',
    'https://admin.lvh.me:8443',
  ])
  assertEquals(
    placed.derived['login.landing'].value,
    'https://dashboard.lvh.me:8443',
  )
  assertEquals(placed.derived['advanced.crossSubDomainCookies'].value, {
    enabled: true,
    domain: 'lvh.me',
  })
})

Deno.test('place: the digest covers the references, so every environment runs the same manifest', async () => {
  const registry = defaultRegistry()
  const resolved = registry.resolve(anywhere())
  assertEquals(resolved.auth.baseURL, { env: 'AUTH_BASE_URL' } as never)
  assertEquals(
    await registry.digest(anywhere()),
    await registry.digest(anywhere()),
  )
})

Deno.test('place: every reference nothing is set for, at once', () => {
  const error = assertThrows(
    () =>
      new Placement((name) =>
        name === 'AUTH_BASE_URL' ? 'https://auth.lvh.me' : undefined
      ).place(anywhere()),
    UnplaceableManifestError,
  )
  assertEquals(error.problems, [
    'auth.applications.0.origin: DASHBOARD_ORIGIN is not set',
    'auth.applications.1.origin: ADMIN_ORIGIN is not set',
    'auth.session.cookieDomain: AUTH_COOKIE_DOMAIN is not set',
  ])
})

Deno.test('place: what is read is checked like what is written', () => {
  const error = assertThrows(
    () =>
      new Placement((name) =>
        ({
          AUTH_BASE_URL: 'https://auth.lvh.me',
          DASHBOARD_ORIGIN: 'https://dashboard.elsewhere.app',
          ADMIN_ORIGIN: 'https://dashboard.elsewhere.app/admin',
          AUTH_COOKIE_DOMAIN: 'lvh.me',
        })[name]
      ).place(anywhere()),
    UnplaceableManifestError,
  )
  assertEquals(
    error.problems.some((p) => p.includes('outside the cookie domain')),
    true,
  )
  assertEquals(
    error.problems.some((p) => p.includes('Must be an exact origin')),
    true,
  )
})

Deno.test('place: a bootstrap user whose email is not set here is not created here', () => {
  const manifest = parseManifest({
    ...anywhere(),
    bootstrap: {
      users: [
        { email: { env: 'KHATM_ADMIN_EMAIL' }, name: 'Admin', role: 'admin' },
        { email: 'root@ritaj.app', name: 'Root' },
      ],
    },
  })
  assertEquals(development.place(manifest).bootstrap?.users, [
    { email: 'root@ritaj.app', name: 'Root' },
  ])
  assertEquals(
    new Placement((name) =>
      name === 'KHATM_ADMIN_EMAIL' ? 'dev@lvh.me' : undefined
    ).bootstrap(manifest.bootstrap!).users.map((user) => user.email),
    ['dev@lvh.me', 'root@ritaj.app'],
  )
})

Deno.test('readings: each reference and what it reads, set or not', () => {
  const readings = new Placement((name) =>
    name === 'AUTH_BASE_URL' ? 'https://auth.lvh.me' : undefined
  ).readings(anywhere())
  assertEquals(readings[0], {
    path: 'auth.baseURL',
    env: 'AUTH_BASE_URL',
    value: 'https://auth.lvh.me',
  })
  assertEquals(readings[1].value, undefined)
})
