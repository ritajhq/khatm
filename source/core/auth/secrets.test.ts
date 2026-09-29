import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from '@std/assert'
import {
  fingerprint,
  fingerprintSecrets,
  resolveAllSecrets,
  resolveSecret,
  UnresolvedSecretsError,
} from './secrets.ts'
import { fakeSource, resolvedSqlite, secretValues } from './test-support.ts'

Deno.test("resolveSecret: reads env vars and files, trimming the file's final newline", () => {
  const source = fakeSource({ A: 'from-env' }, {
    '/run/secrets/b': 'from-file\n',
  })
  assertEquals(resolveSecret({ env: 'A' }, source), 'from-env')
  assertEquals(resolveSecret({ file: '/run/secrets/b' }, source), 'from-file')
})

Deno.test('resolveSecret: an empty, unset or unreadable secret is unresolved', () => {
  const source = fakeSource({ EMPTY: '' })
  for (const ref of [{ env: 'EMPTY' }, { env: 'NOPE' }, { file: '/missing' }]) {
    assertThrows(() => resolveSecret(ref, source), UnresolvedSecretsError)
  }
})

Deno.test('resolveAllSecrets: names every secret that is missing, not just the first', () => {
  const auth = resolvedSqlite().auth
  const error = assertThrows(
    () => resolveAllSecrets(auth, fakeSource({})),
    UnresolvedSecretsError,
  )
  assertEquals(error.refs, ['env:AUTH_SECRET_1', 'env:DATABASE'])
})

Deno.test('fingerprint: stable, changes with the value or the key, and hides the value', async () => {
  const one = await fingerprint('install-key', 'secret-value')
  assertEquals(one, await fingerprint('install-key', 'secret-value'))
  assertNotEquals(one, await fingerprint('install-key', 'other-value'))
  assertNotEquals(one, await fingerprint('other-key', 'secret-value'))
  assertEquals(one.includes('secret'), false)
  assertEquals(one.length, 64)
})

Deno.test('fingerprintSecrets: one fingerprint per reference', async () => {
  const fingerprints = await fingerprintSecrets(
    resolvedSqlite().auth,
    fakeSource(secretValues('/tmp/x.db')),
    'install-key',
  )
  assertEquals(Object.keys(fingerprints), ['env:AUTH_SECRET_1', 'env:DATABASE'])
  await assertRejects(
    () => fingerprintSecrets(resolvedSqlite().auth, fakeSource({}), 'k'),
    UnresolvedSecretsError,
  )
})
