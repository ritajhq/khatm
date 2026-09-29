import { type SecretRef, secretRefKey, secretRefs } from '@khatm/spec'
import type { AuthSpec } from '@khatm/spec'

/** Where secret references are read from: the environment and mounted files. */
export interface SecretSource {
  env(name: string): string | undefined
  readFile(path: string): string
}

export const processSecrets: SecretSource = {
  env: (name) => Deno.env.get(name),
  readFile: (path) => Deno.readTextFileSync(path),
}

export class UnresolvedSecretsError extends Error {
  constructor(readonly refs: string[]) {
    super(`Secrets that don't resolve: ${refs.join(', ')}`)
  }
}

/** The value a reference points at, or undefined when it isn't there or is empty. */
export function tryResolveSecret(
  ref: SecretRef,
  source: SecretSource,
): string | undefined {
  let value: string | undefined
  if ('env' in ref) {
    value = source.env(ref.env)
  } else {
    try {
      // Mounted secret files usually end with a newline that isn't part of the value.
      value = source.readFile(ref.file).replace(/\r?\n$/, '')
    } catch {
      value = undefined
    }
  }
  return value === undefined || value === '' ? undefined : value
}

export function resolveSecret(ref: SecretRef, source: SecretSource): string {
  const value = tryResolveSecret(ref, source)
  if (value === undefined) throw new UnresolvedSecretsError([secretRefKey(ref)])
  return value
}

/** Every secret an auth spec references, by reference key; says all that are missing at once. */
export function resolveAllSecrets(
  auth: AuthSpec,
  source: SecretSource,
): Record<string, string> {
  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const ref of secretRefs(auth)) {
    const key = secretRefKey(ref)
    const value = tryResolveSecret(ref, source)
    if (value === undefined) missing.push(key)
    else values[key] = value
  }
  if (missing.length > 0) {
    throw new UnresolvedSecretsError([...new Set(missing)])
  }
  return values
}

/**
 * A fingerprint of a secret's value: an HMAC under a per-install key, so it
 * shows that a value changed without revealing it, and can't be checked
 * against guesses without the key.
 */
export async function fingerprint(key: string, value: string): Promise<string> {
  const encoder = new TextEncoder()
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(value)),
  )
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Fingerprints of every secret the auth spec references, keyed by reference. */
export async function fingerprintSecrets(
  auth: AuthSpec,
  source: SecretSource,
  key: string,
): Promise<Record<string, string>> {
  const values = resolveAllSecrets(auth, source)
  const out: Record<string, string> = {}
  for (const ref of Object.keys(values).sort()) {
    out[ref] = await fingerprint(key, values[ref])
  }
  return out
}
