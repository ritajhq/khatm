import { z } from 'zod'
import { placeable } from './env-ref.ts'

const Domain = z.string().regex(
  /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/,
  { message: 'Must be a multi-label domain such as ritaj.app' },
)

const CookiePrefix = z.string().regex(
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  {
    message: 'Must be lowercase letters, digits and hyphens, such as platform',
  },
)

/** Better Auth's own cookie prefix, used when the session contract names none. */
export const DEFAULT_COOKIE_PREFIX = 'better-auth'

/**
 * What resource servers, such as idhn guards, rely on to identify a caller.
 * Changing any of it breaks those consumers, so `plan` treats it as a
 * published interface.
 */
export const SessionContract = z.object({
  /** Shared parent domain the session cookie is scoped to. */
  cookieDomain: placeable(Domain).optional(),
  /**
   * What the session cookie's name starts with: `<prefix>.session_token`.
   * Unset is `better-auth`. Auth servers whose cookies reach the same hosts
   * (one domain nested in another's) each need their own, or a browser sends
   * both under one name and a guard can't tell whose session it holds.
   */
  cookiePrefix: placeable(CookiePrefix).optional(),
  /** The internal get-session address guards call, never the public one. */
  introspectionURL: placeable(z.url()),
  /** The issuer guards report to policies, such as `portal`. */
  issuer: z.string().min(1),
  /** User fields exposed to guards as claims. */
  claims: z.array(z.string().min(1)).superRefine((claims, ctx) => {
    const duplicates = claims.filter((claim, index) =>
      claims.indexOf(claim) !== index
    )
    for (const claim of new Set(duplicates)) {
      ctx.addIssue({
        code: 'custom',
        message: `Claim "${claim}" is listed twice`,
      })
    }
  }),
}).strict()
export type SessionContract = z.infer<typeof SessionContract>
