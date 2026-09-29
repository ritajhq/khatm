import { landingApplication, type ResolvedManifest } from '@khatm/spec'
import { z } from 'zod'

/**
 * What the hosted pages need to know, projected from the resolved manifest:
 * which sign-in methods to show and where a user may be sent back to. The
 * pages never see secrets or anything else in the manifest.
 */
export const PageConfig = z.object({
  /** The service's own name, shown on the pages; empty when branding has none. */
  name: z.string(),
  emailAndPassword: z.object({
    enabled: z.boolean(),
    requireVerification: z.boolean(),
  }),
  /** Sign in with a username as well as an email. */
  username: z.boolean(),
  socialProviders: z.array(z.string()),
  /** Origins `return_to` may point at. */
  returnOrigins: z.array(z.string()),
  /** Where sign-in lands without a valid `return_to`. */
  landing: z.string().optional(),
  messages: z.record(z.string(), z.record(z.string(), z.string())),
})
export type PageConfig = z.infer<typeof PageConfig>

export function pageConfig(resolved: ResolvedManifest): PageConfig {
  const { auth } = resolved
  const firstParty = auth.applications.filter((a) => a.kind === 'first-party')
  return {
    name: resolved.branding.name ?? '',
    emailAndPassword: {
      enabled: auth.emailAndPassword?.enabled ?? false,
      requireVerification: auth.emailAndPassword?.requireVerification ?? false,
    },
    username: auth.plugins.some((p) => p.kind === 'username'),
    socialProviders: Object.keys(auth.socialProviders).sort(),
    returnOrigins: firstParty.map((a) => a.origin),
    landing: landingApplication(auth.applications)?.origin,
    messages: resolved.branding.messages,
  }
}

/** Whether the pages have any way to sign in at all. */
export function hasSignInMethod(config: PageConfig): boolean {
  return config.emailAndPassword.enabled || config.socialProviders.length > 0
}

/**
 * Where to send a user once signed in: the page that sent them here, when it
 * belongs to one of the service's own apps (anything else would make the
 * login page an open redirect), else the landing app, else this origin's root.
 */
export function safeReturnTo(
  returnTo: string | null | undefined,
  config: Pick<PageConfig, 'returnOrigins' | 'landing'>,
): string {
  const fallback = config.landing ?? '/'
  if (!returnTo || !URL.canParse(returnTo)) return fallback
  const url = new URL(returnTo)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback
  return config.returnOrigins.includes(url.origin) ? url.href : fallback
}
