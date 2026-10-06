/**
 * How OAuth client secrets are stored: a SHA-256 digest, never the secret.
 * khatm writes the client rows itself from the manifest, so it has to hash
 * exactly the way Better Auth verifies; owning the function makes that a
 * fact instead of a guess about Better Auth's internals. Secrets are random
 * and high-entropy, so a fast digest is enough: there is nothing to
 * brute-force the way there is with a password.
 */
export class ClientSecretHash {
  async hash(clientSecret: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(clientSecret),
    )
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  async verify(clientSecret: string, storedHash: string): Promise<boolean> {
    const actual = await this.hash(clientSecret)
    return timingSafeEqual(actual, storedHash)
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return difference === 0
}
