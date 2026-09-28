import { assertEquals, assertNotEquals, assertThrows } from '@std/assert'
import { manifest } from './test-fixtures.ts'
import type { Manifest } from './manifest.ts'
import {
  ConflictingDerivationError,
  type Derivation,
  digestOf,
  resolve,
} from './resolve.ts'

const origins: Derivation = {
  derive: (m: Manifest) => ({
    trustedOrigins: {
      value: m.auth.applications.map((app) =>
        app.kind === 'first-party' ? app.origin : app.id
      ),
      derivedFrom: 'auth.applications',
    },
  }),
}

Deno.test('resolve: adds what each derivation derives and drops bootstrap', () => {
  const resolved = resolve(
    manifest({ bootstrap: { users: [] } }),
    [origins],
  )
  assertEquals(resolved.derived, {
    trustedOrigins: {
      value: ['https://dashboard.example.com'],
      derivedFrom: 'auth.applications',
    },
  })
  assertEquals('bootstrap' in resolved, false)
})

Deno.test('resolve: two derivations may not write the same entry', () => {
  assertThrows(
    () => resolve(manifest(), [origins, origins]),
    ConflictingDerivationError,
  )
})

Deno.test('resolve: a derived plugin may not also be authored', () => {
  const adminFromClaims: Derivation = {
    derive: () => ({
      'plugins.admin': {
        value: { kind: 'admin', options: {} },
        derivedFrom: 'auth.session.claims',
      },
    }),
  }
  const error = assertThrows(
    () =>
      resolve(
        manifest({ auth: { plugins: [{ kind: 'admin' }] } }),
        [adminFromClaims],
      ),
    ConflictingDerivationError,
  )
  assertEquals(
    error.message,
    'Plugin "admin" is derived from auth.session.claims; remove it from auth.plugins',
  )
})

Deno.test('digestOf: ignores bootstrap and key order, sees content', async () => {
  const base = await digestOf(resolve(manifest(), []))
  assertEquals(
    await digestOf(resolve(
      manifest({
        bootstrap: {
          users: [{ email: 'admin@example.com', name: 'Admin', role: 'admin' }],
        },
      }),
      [],
    )),
    base,
  )
  assertNotEquals(
    await digestOf(resolve(
      manifest({ branding: { tokens: { primary: '#0a0' } } }),
      [],
    )),
    base,
  )
})
