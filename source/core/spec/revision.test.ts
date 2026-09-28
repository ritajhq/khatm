import { assertEquals, assertNotEquals, assertThrows } from '@std/assert'
import { InvalidRevisionError, Revision } from './revision.ts'

const digest = `sha256:${'a'.repeat(64)}`

Deno.test('Revision: a rollback is a new revision pointing at an older manifest', () => {
  const first = Revision.create({ manifest: digest, author: 'u-1' })
  const second = Revision.create({
    manifest: `sha256:${'b'.repeat(64)}`,
    parent: first.id,
    author: 'u-1',
  })
  const rollback = Revision.create({
    manifest: first.manifest,
    parent: second.id,
    author: 'u-2',
    reason: `rollback to ${first.id}`,
  })
  assertEquals(rollback.manifest, first.manifest)
  assertNotEquals(rollback.id, first.id)
  assertEquals(rollback.parent, second.id)
})

Deno.test('Revision: needs an author and a manifest digest', () => {
  assertThrows(
    () => Revision.create({ manifest: digest, author: ' ' }),
    InvalidRevisionError,
  )
  assertThrows(
    () => Revision.create({ manifest: 'abc', author: 'socket' }),
    InvalidRevisionError,
  )
})
