import { assertEquals } from '@std/assert'
import { parse } from '@std/yaml'
import { defaultRegistry } from '@khatm/registry'
import { portal } from '@khatm/registry/test-fixtures'
import {
  consoleGuardManifest,
  controlGuardManifest,
  sessionCookieName,
  toYaml,
} from './guard.ts'
import { procedures } from './procedures.ts'

const resolved = defaultRegistry().resolve(portal())

Deno.test('controlGuardManifest: one action per procedure, none left unguarded', () => {
  const manifest = controlGuardManifest(resolved)
  assertEquals(
    manifest.actions.map((a) => a.name).sort(),
    Object.values(procedures).map((p) => p.name).sort(),
  )
  for (const action of manifest.actions) {
    assertEquals(action.match, { method: 'POST', path: `/${action.name}` })
  }
  const rollback = manifest.actions.find((a) => a.name === 'khatm.rollback')!
  assertEquals(rollback.extract?.[0], {
    from: { property: 'body', using: 'revision', type: 'json' },
    as: 'revision',
  })
})

Deno.test('guard manifests: authenticate with the session contract portal publishes', () => {
  for (
    const manifest of [
      controlGuardManifest(resolved),
      consoleGuardManifest(resolved),
    ]
  ) {
    assertEquals(manifest.authentication, [{
      scheme: 'session-cookie',
      session_url: 'http://auth:4100/api/auth/get-session',
      issuer: 'portal',
      claims: ['username', 'email', 'name', 'emailVerified', 'role'],
      cookie: '__Secure-better-auth.session_token',
    }])
  }
  assertEquals(
    sessionCookieName('http://localhost:4100'),
    'better-auth.session_token',
  )
})

Deno.test('guard manifests: the YAML round-trips to the same manifest', () => {
  const manifest = consoleGuardManifest(resolved)
  assertEquals(parse(toYaml(manifest)), manifest)
})

Deno.test('ship/guard: the shipped example manifests are what the generator makes for portal', () => {
  const ship = new URL('../../ship/guard/', import.meta.url)
  assertEquals(
    Deno.readTextFileSync(new URL('control/manifest.yaml', ship)),
    toYaml(controlGuardManifest(resolved)),
  )
  assertEquals(
    Deno.readTextFileSync(new URL('console/manifest.yaml', ship)),
    toYaml(consoleGuardManifest(resolved)),
  )
})

Deno.test('controlGuardManifest: every fact is an input field, and no password is one', () => {
  for (const action of controlGuardManifest(resolved).actions) {
    const procedure = Object.values(procedures).find((p) =>
      p.name === action.name
    )!
    const fields = Object.keys(
      (procedure.input as unknown as { shape: object }).shape,
    )
    for (const fact of action.extract ?? []) {
      const field = fact.from.using
      assertEquals(fields.includes(field), true, `${action.name}: ${field}`)
      assertEquals(field === 'password', false)
    }
  }
})
