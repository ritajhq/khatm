import { z } from 'zod'

/**
 * How the hosted pages look. What appears on them comes from `AuthSpec`, so
 * a branding change never touches auth behavior.
 */
export const BrandingSpec = z.object({
  /** Design tokens, applied as CSS custom properties. */
  tokens: z.record(z.string(), z.string()).default({}),
  /** Copy overrides per locale, keyed by message id. */
  messages: z.record(z.string(), z.record(z.string(), z.string())).default({}),
}).strict()
export type BrandingSpec = z.infer<typeof BrandingSpec>
