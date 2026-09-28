import type { Json } from './json.ts'

/**
 * JSON with object keys sorted and `undefined` dropped, so equal content
 * always serializes to the same string whatever order it was written in.
 * Array order is kept: it can be meaningful (plugin order is).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): Json {
  if (value === null) return null
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot canonicalize ${value}`)
      }
      return value
    case 'object': {
      if (Array.isArray(value)) {
        return value.map((item) => item === undefined ? null : normalize(item))
      }
      const out: { [key: string]: Json } = {}
      for (const key of Object.keys(value).sort()) {
        const item = (value as Record<string, unknown>)[key]
        if (item !== undefined) out[key] = normalize(item)
      }
      return out
    }
    default:
      throw new TypeError(`Cannot canonicalize a ${typeof value}`)
  }
}

/** `sha256:<hex>` of the canonical serialization. */
export async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `sha256:${
    Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }`
}
