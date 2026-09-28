import { z } from 'zod'

/**
 * An exact web origin (`https://dashboard.ritaj.app`): scheme, host and
 * optional port, with no path, query or wildcard. Origins end up in Better
 * Auth's `trustedOrigins` and the login page's `return_to` allowlist, where
 * anything looser would open a redirect.
 */
export const Origin = z.string().refine(isOrigin, {
  message:
    'Must be an exact origin such as https://app.example.com, with no path, query or wildcard',
})

function isOrigin(value: string): boolean {
  if (value.includes('*')) return false
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.origin === value
}

/** Whether `host` is `domain` itself or one of its subdomains. */
export function isWithinDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}
