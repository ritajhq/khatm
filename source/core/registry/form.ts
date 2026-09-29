import { z } from 'zod'

/** One input a generated form shows for an option. */
export type FormField =
  & { readonly name: string; readonly required: boolean }
  & (
    | {
      readonly type: 'number' | 'integer'
      readonly minimum?: number
      readonly maximum?: number
    }
    | { readonly type: 'string'; readonly minLength?: number }
    | { readonly type: 'boolean' }
    | { readonly type: 'enum'; readonly values: readonly string[] }
  )

/**
 * The fields of a form for an options schema, so a new registry entry gets
 * a form in the console with no UI code. Only flat objects of scalars are
 * turned into fields; anything else is reported as unsupported so the
 * console falls back to editing it as JSON.
 */
export function formFields(
  schema: z.ZodType,
): { fields: FormField[]; unsupported: string[] } {
  const json = z.toJSONSchema(schema, { io: 'input' }) as {
    type?: string
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
  }
  const fields: FormField[] = []
  const unsupported: string[] = []
  if (json.type !== 'object') return { fields, unsupported: ['(root)'] }
  const required = new Set(json.required ?? [])
  for (const [name, property] of Object.entries(json.properties ?? {})) {
    const base = { name, required: required.has(name) }
    if (Array.isArray(property.enum)) {
      fields.push({ ...base, type: 'enum', values: property.enum.map(String) })
    } else if (property.type === 'integer' || property.type === 'number') {
      fields.push({
        ...base,
        type: property.type,
        ...(typeof property.minimum === 'number'
          ? { minimum: property.minimum }
          : typeof property.exclusiveMinimum === 'number'
          ? {
            minimum: property.exclusiveMinimum +
              (property.type === 'integer' ? 1 : 0),
          }
          : {}),
        // Zod writes MAX_SAFE_INTEGER for a plain `.int()`: that is no limit.
        ...(typeof property.maximum === 'number' &&
            property.maximum < Number.MAX_SAFE_INTEGER
          ? { maximum: property.maximum }
          : {}),
      })
    } else if (property.type === 'string') {
      fields.push({
        ...base,
        type: 'string',
        ...(typeof property.minLength === 'number'
          ? { minLength: property.minLength }
          : {}),
      })
    } else if (property.type === 'boolean') {
      fields.push({ ...base, type: 'boolean' })
    } else {
      unsupported.push(name)
    }
  }
  return { fields, unsupported }
}
