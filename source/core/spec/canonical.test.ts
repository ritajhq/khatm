import { assertEquals, assertNotEquals, assertThrows } from '@std/assert'
import { canonicalize, sha256 } from './canonical.ts'

Deno.test('canonicalize: sorts keys at every depth', () => {
  assertEquals(
    canonicalize({ b: 1, a: { d: 2, c: 3 } }),
    canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
  )
  assertEquals(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}')
})

Deno.test('canonicalize: keeps array order, which can matter', () => {
  assertNotEquals(canonicalize([1, 2]), canonicalize([2, 1]))
})

Deno.test('canonicalize: drops undefined properties', () => {
  assertEquals(canonicalize({ a: 1, b: undefined }), '{"a":1}')
})

Deno.test('canonicalize: refuses values JSON cannot round-trip', () => {
  assertThrows(() => canonicalize({ a: NaN }), TypeError)
  assertThrows(() => canonicalize({ a: () => 1 }), TypeError)
})

Deno.test('sha256: is prefixed and stable across key order', async () => {
  const digest = await sha256({ b: 1, a: 2 })
  assertEquals(digest.startsWith('sha256:'), true)
  assertEquals(digest, await sha256({ a: 2, b: 1 }))
})
