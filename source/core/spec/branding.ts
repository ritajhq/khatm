import { z } from 'zod'

/** A token is a CSS custom property `--<name>`: lowercase words joined by dashes. */
export const TokenName = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
  message:
    'Must be lowercase words joined by dashes, like "primary-foreground"',
})

/**
 * Token values end up inside a stylesheet, so they can't close a rule, start
 * another, or fetch anything: no braces, semicolons, angle brackets,
 * backslashes, comments, `url(`, `@import` or `expression(`.
 */
export const TokenValue = z.string().min(1).max(200).refine(
  (value) => !/[{};<>\\]|\/\*|url\s*\(|@import|expression\s*\(/i.test(value),
  {
    message: 'Not a plain CSS value (no braces, semicolons, comments or url())',
  },
)

/**
 * How the hosted pages look. What appears on them comes from `AuthSpec`, so
 * a branding change never touches auth behavior.
 */
export const BrandingSpec = z.object({
  /** The service's name, shown on the hosted pages. Left out, they show none. */
  name: z.string().min(1).max(60).optional(),
  /** Design tokens, applied as CSS custom properties. */
  tokens: z.record(TokenName, TokenValue).default({}),
  /** Copy overrides per locale, keyed by message id. */
  messages: z.record(z.string(), z.record(z.string(), z.string())).default({}),
}).strict()
export type BrandingSpec = z.infer<typeof BrandingSpec>
