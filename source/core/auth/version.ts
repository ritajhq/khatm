import { getBetterAuthVersion } from '@better-auth/core/context'

/**
 * The running Better Auth version. Asked of Better Auth itself rather than
 * read from its package.json, which a bundled build no longer ships.
 */
export function betterAuthVersion(): string {
  return getBetterAuthVersion()
}
