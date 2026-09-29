import { z } from 'zod'
import { MAX_SLOT_LENGTH, sanitizeSlot } from './slot.ts'

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
 * The hosted pages' stable part names: each element carries
 * `data-khatm-part="<name>"`, and scoped CSS can only target these. Renaming
 * or removing one breaks operators' styles, so this list only grows.
 */
export const PART_NAMES = [
  'page',
  'brand',
  'card',
  'header',
  'title',
  'description',
  'content',
  'form',
  'field',
  'label',
  'input',
  'submit',
  'social',
  'provider',
  'alert',
  'switch',
  'slot-header',
  'slot-footer',
  'slot-legal',
] as const
export const PartName = z.enum(PART_NAMES)
export type PartName = z.infer<typeof PartName>

/** A CSS property, or a custom property, in lowercase with dashes. */
export const CssProperty = z.string().regex(
  /^(--)?[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  { message: 'Must be a CSS property name, like "border-radius"' },
)

/** Where operator markup may go on the hosted pages. */
export const SLOT_NAMES = ['header', 'footer', 'legal'] as const
export const SlotName = z.enum(SLOT_NAMES)
export type SlotName = z.infer<typeof SlotName>

/** Slot markup must come through the sanitizer unchanged in meaning: nothing may be dropped. */
export const SlotHtml = z.string().max(MAX_SLOT_LENGTH).superRefine(
  (html, context) => {
    for (const problem of sanitizeSlot(html).problems) {
      context.addIssue({ code: 'custom', message: problem })
    }
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
  /**
   * Scoped CSS: declarations per stable part. Values follow the token rules,
   * so styles can't escape their rule or fetch anything.
   */
  parts: z.partialRecord(PartName, z.record(CssProperty, TokenValue))
    .optional(),
  /** Sanitized markup per locale and slot, chosen like `messages`. */
  slots: z.record(z.string(), z.partialRecord(SlotName, SlotHtml)).optional(),
  /**
   * `headless` serves no pages: the service's own apps build them with the
   * Better Auth client, and khatm keeps only the API.
   */
  pages: z.enum(['hosted', 'headless']).optional(),
}).strict()
export type BrandingSpec = z.infer<typeof BrandingSpec>
