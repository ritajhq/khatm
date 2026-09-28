import { assertEquals, assertThrows } from '@std/assert'
import { plan } from '@khatm/spec'
import { defaultRegistry, UnresolvableManifestError } from './registry.ts'
import { portal } from './test-fixtures.ts'

const registry = defaultRegistry()

function problemsOf(auth: Record<string, unknown>): string[] {
  return assertThrows(
    () => registry.resolve(portal(auth)),
    UnresolvableManifestError,
  ).problems
}

Deno.test('Registry: resolves portal, deriving what portal wires by hand today', () => {
  assertEquals(registry.resolve(portal()).derived, {
    trustedOrigins: {
      value: ['https://dashboard.ritaj.app', 'https://admin.ritaj.app'],
      derivedFrom: 'auth.applications',
    },
    'login.returnTo': {
      value: ['https://dashboard.ritaj.app', 'https://admin.ritaj.app'],
      derivedFrom: 'auth.applications',
    },
    'login.landing': {
      value: 'https://dashboard.ritaj.app',
      derivedFrom: 'auth.applications',
    },
    'advanced.crossSubDomainCookies': {
      value: { enabled: true, domain: 'ritaj.app' },
      derivedFrom: 'auth.session.cookieDomain',
    },
    'plugins.admin': {
      value: { kind: 'admin', options: {} },
      derivedFrom: 'auth.session.claims',
    },
  })
})

Deno.test('Registry: the first first-party app lands when none is marked', () => {
  const resolved = registry.resolve(portal({
    applications: [
      { kind: 'first-party', id: 'admin', origin: 'https://admin.ritaj.app' },
      {
        kind: 'first-party',
        id: 'dashboard',
        origin: 'https://dashboard.ritaj.app',
      },
    ],
  }))
  assertEquals(
    resolved.derived['login.landing'].value,
    'https://admin.ritaj.app',
  )
})

Deno.test('Registry: rejects unknown plugins and bad options', () => {
  assertEquals(
    problemsOf({ plugins: [{ kind: 'passkey' }] }),
    ['auth.plugins.0: Unknown plugin "passkey"'],
  )
  assertEquals(
    problemsOf({
      plugins: [{ kind: 'username', options: { minUsernameLength: -1 } }],
    }),
    [
      'auth.plugins.0.options.minUsernameLength: Too small: expected number to be >0',
    ],
  )
})

Deno.test('Registry: the admin plugin is derived, never written', () => {
  assertEquals(
    problemsOf({ plugins: [{ kind: 'username' }, { kind: 'admin' }] }),
    ['auth.plugins.1: "admin" is derived by khatm and can\'t be written by hand'],
  )
})

Deno.test('Registry: every claim must come from an installed plugin', () => {
  assertEquals(
    problemsOf({
      plugins: [],
      session: {
        cookieDomain: 'ritaj.app',
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'portal',
        claims: ['username', 'email'],
      },
    }),
    ['auth.session.claims: No installed plugin provides the "username" field'],
  )
})

Deno.test('Registry: bootstrap users never change the digest', async () => {
  const withoutBootstrap = { ...portal(), bootstrap: undefined }
  assertEquals(
    await registry.digest(withoutBootstrap),
    await registry.digest(portal()),
  )
})

Deno.test('Registry: adding an app shows both the app and what it re-derives', async () => {
  const result = await plan(
    registry.resolve(portal()),
    registry.resolve(portal({
      applications: [
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.ritaj.app',
          landing: true,
        },
        {
          kind: 'first-party',
          id: 'admin',
          origin: 'https://admin.ritaj.app',
        },
        {
          kind: 'first-party',
          id: 'console',
          origin: 'https://console.ritaj.app',
        },
      ],
    })),
  )
  assertEquals(
    result.steps.map(({ path, impact, derivedFrom }) => ({
      path,
      impact,
      derivedFrom,
    })),
    [
      {
        path: 'auth.applications[console]',
        impact: 'restart',
        derivedFrom: undefined,
      },
      {
        path: 'derived[login.returnTo]',
        impact: 'restart',
        derivedFrom: 'auth.applications',
      },
      {
        path: 'derived[trustedOrigins]',
        impact: 'restart',
        derivedFrom: 'auth.applications',
      },
    ],
  )
})
