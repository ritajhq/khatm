import { assertEquals } from '@std/assert'
import { z } from 'zod'
import { formFields } from './form.ts'
import { username } from './plugins.ts'

Deno.test('formFields: the username plugin gets two whole-number fields', () => {
  assertEquals(formFields(username.options), {
    fields: [
      {
        name: 'minUsernameLength',
        required: false,
        type: 'integer',
        minimum: 1,
      },
      {
        name: 'maxUsernameLength',
        required: false,
        type: 'integer',
        minimum: 1,
      },
    ],
    unsupported: [],
  })
})

Deno.test('formFields: scalars become fields, anything nested is left to JSON', () => {
  const schema = z.object({
    label: z.string().min(2),
    on: z.boolean().optional(),
    mode: z.enum(['a', 'b']),
    nested: z.object({ x: z.number() }),
  })
  const { fields, unsupported } = formFields(schema)
  assertEquals(fields.map((f) => [f.name, f.type, f.required]), [
    ['label', 'string', true],
    ['on', 'boolean', false],
    ['mode', 'enum', true],
  ])
  assertEquals(unsupported, ['nested'])
})
