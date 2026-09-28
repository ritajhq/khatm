import { z } from 'zod'

const Domain = z.string().regex(
  /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/,
  { message: 'Must be a multi-label domain such as ritaj.app' },
)

/**
 * What resource servers, such as idhn guards, rely on to identify a caller.
 * Changing any of it breaks those consumers, so `plan` treats it as a
 * published interface.
 */
export const SessionContract = z.object({
  /** Shared parent domain the session cookie is scoped to. */
  cookieDomain: Domain.optional(),
  /** The internal get-session address guards call, never the public one. */
  introspectionURL: z.url(),
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
