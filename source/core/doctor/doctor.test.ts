import { assertEquals } from '@std/assert'
import { parse } from '@std/yaml'
import { defaultRegistry } from '@khatm/registry'
import { portal } from '@khatm/registry/test-fixtures'
import {
  configFindings,
  failed,
  type Finding,
  guardFindings,
  type Probes,
  runtimeFindings,
} from './doctor.ts'

const registry = defaultRegistry()
const not = (severity: string) => (f: Finding) => f.severity !== severity
const brief = (findings: Finding[]) =>
  findings.map((f) => `${f.severity} ${f.check}`)

Deno.test('configFindings: portal is consistent, and its provider callback is listed', () => {
  const findings = configFindings(registry.resolve(portal({
    socialProviders: {
      github: {
        clientId: { env: 'GH_ID' },
        clientSecret: { env: 'GH_SECRET' },
      },
    },
  })))
  assertEquals(findings.filter(not('ok')), [{
    check: 'oauth-redirect',
    severity: 'info',
    message:
      'Register https://auth.ritaj.app/api/auth/callback/github as a redirect URI with github',
  }])
})

Deno.test('configFindings: cookies that never reach an app, and http in public', () => {
  const findings = configFindings(registry.resolve(portal({
    baseURL: 'http://auth.ritaj.app',
    applications: [
      { kind: 'first-party', id: 'shop', origin: 'https://shop.example.com' },
    ],
    session: {
      introspectionURL: 'http://auth:4100/api/auth/get-session',
      issuer: 'portal',
      claims: ['email'],
    },
  })))
  assertEquals(brief(findings.filter(not('ok'))), [
    'warn base-url',
    'warn cookie-domain',
    'warn base-url',
  ])
  assertEquals(failed(findings), false)
})

Deno.test("guardFindings: the shipped guard manifests match portal's contract; a stale one fails", () => {
  const resolved = registry.resolve(portal())
  const ship = new URL('../../ship/guard/', import.meta.url)
  const control = parse(
    Deno.readTextFileSync(new URL('control/manifest.yaml', ship)),
  )
  const stale = {
    authentication: {
      scheme: 'session-cookie',
      session_url: 'http://auth:4100/api/auth/get-session',
      issuer: 'portal',
      claims: ['email', 'tenant'],
      cookie: 'better-auth.session_token',
    },
  }
  const findings = guardFindings(resolved, [
    { name: 'control', manifest: control },
    { name: 'places', manifest: stale },
    { name: 'public', manifest: { authentication: [] } },
  ])
  assertEquals(brief(findings), [
    'ok guard:control',
    'fail guard:places',
    'warn guard:public',
  ])
  assertEquals(
    findings[1].message,
    'cookie is "better-auth.session_token", not __Secure-better-auth.session_token; claims tenant aren\'t in the session contract',
  )
})

Deno.test('runtimeFindings: missing secrets skip the database, and unreachable URLs say how bad', async () => {
  const resolved = registry.resolve(portal())
  const probes = (overrides: Partial<Probes>): Probes => ({
    missingSecrets: () => [],
    database: () => Promise.resolve({ pending: [] }),
    sharesStore: () => true,
    status: () => Promise.resolve(200),
    upstream: 'http://127.0.0.1:1',
    ...overrides,
  })
  assertEquals(
    brief(await runtimeFindings(resolved, probes({}))),
    ['ok secrets', 'ok database', 'info store', 'ok worker', 'ok public-url'],
  )
  const broken = await runtimeFindings(
    resolved,
    probes({
      missingSecrets: () => ['env:DATABASE_URL'],
      status: (url) =>
        url.startsWith('https://')
          ? Promise.reject(new Error('dns error'))
          : Promise.resolve(503),
    }),
  )
  assertEquals(brief(broken), [
    'fail secrets',
    'info store',
    'fail worker',
    'warn public-url',
  ])
})
