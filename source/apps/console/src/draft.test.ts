import { assert, assertEquals } from '@std/assert'
import {
  branding,
  check,
  plugins,
  previewQuery,
  withBranding,
  withPlugin,
} from './draft.ts'

const base = {
  auth: {
    baseURL: 'https://auth.example.com',
    secrets: [{ version: 1, value: { env: 'S' } }],
    database: { dialect: 'sqlite', url: { env: 'D' } },
    emailAndPassword: { enabled: true },
    session: {
      introspectionURL: 'http://auth:4100/api/auth/get-session',
      issuer: 'example',
      claims: ['email'],
    },
  },
}

Deno.test("check: runs the orchestrator's own validation in the browser", () => {
  assert(check(JSON.stringify(base)).ok)
  const broken = check('{"auth":{}}')
  assert(!broken.ok && broken.problems.length > 0)
  const notJson = check('{')
  assert(!notJson.ok && notJson.problems[0].startsWith('Not JSON'))
  const unknown = check(JSON.stringify(withPlugin(base, 'nope', {})))
  assert(!unknown.ok && unknown.problems[0].includes('Unknown plugin'))
})

Deno.test('withPlugin: turns a plugin on, sets its options, and off again', () => {
  const on = withPlugin(base, 'username', {})
  assertEquals(plugins(on), [{ kind: 'username' }])
  const tuned = withPlugin(on, 'username', { minUsernameLength: 4 })
  assertEquals(plugins(tuned), [{
    kind: 'username',
    options: { minUsernameLength: 4 },
  }])
  assert(check(JSON.stringify(tuned)).ok)
  assertEquals(plugins(withPlugin(tuned, 'username', undefined)), [])
})

Deno.test('branding: edits round-trip and reach the preview', () => {
  const next = withBranding(base, {
    name: 'Acme',
    tokens: { primary: 'red' },
    messages: {},
  })
  assertEquals(branding(next).tokens, { primary: 'red' })
  const result = check(JSON.stringify(next))
  assert(result.ok)
  const query = previewQuery(result.resolved)
  const decoded = JSON.parse(
    atob(query.replaceAll('-', '+').replaceAll('_', '/')),
  )
  assertEquals(decoded.config.name, 'Acme')
  assertEquals(decoded.tokens, { primary: 'red' })
  assertEquals(
    branding(withBranding(next, { tokens: {}, messages: {} })).name,
    undefined,
  )
})
