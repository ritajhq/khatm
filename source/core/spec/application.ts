import { z } from 'zod'
import { Origin } from './origin.ts'
import { SecretRef } from './secret.ts'

export const AppId = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message:
    'Must be lowercase letters, digits and dashes, starting with a letter',
})

/**
 * An app that shares the session cookie with the auth server, like portal's
 * dashboard and admin. Its origin is trusted for CORS and as a place the
 * login page may send a user back to.
 */
export const FirstPartyApplication = z.object({
  kind: z.literal('first-party'),
  id: AppId,
  origin: Origin,
  /** Where sign-in lands when no `return_to` is given. At most one app sets it. */
  landing: z.boolean().optional(),
}).strict()
export type FirstPartyApplication = z.infer<typeof FirstPartyApplication>

/**
 * Where an OAuth app may receive codes: HTTPS anywhere, or plain HTTP on a
 * loopback host (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`) for local
 * development. Better Auth refuses anything else at sign-in, so the manifest
 * refuses it first.
 */
export const RedirectUri = z.url().refine(isAllowedRedirect, {
  message:
    'Must be an https URL, or http on a loopback host such as localhost or app.localhost',
})

function isAllowedRedirect(value: string): boolean {
  const url = new URL(value)
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host) || host === '[::1]'
}

/**
 * An app on any origin that signs users in through khatm with OAuth 2.1 and
 * OpenID Connect ("Login with …"). Its `id` is the OAuth `client_id`. A
 * confidential app authenticates to the token endpoint with `clientSecret`;
 * a public one (a browser or mobile app) has none and relies on PKCE alone.
 */
export const OAuthApplication = z.object({
  kind: z.literal('oauth'),
  id: AppId,
  redirectUris: z.array(RedirectUri).min(1),
  scopes: z.array(z.string().min(1)),
  confidential: z.boolean(),
  clientSecret: SecretRef.optional(),
}).strict().superRefine((app, ctx) => {
  if (app.confidential && app.clientSecret === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientSecret'],
      message: 'A confidential application needs a clientSecret',
    })
  }
  if (!app.confidential && app.clientSecret !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientSecret'],
      message: 'A public application has no clientSecret',
    })
  }
})
export type OAuthApplication = z.infer<typeof OAuthApplication>

export const Application = z.discriminatedUnion('kind', [
  FirstPartyApplication,
  OAuthApplication,
])
export type Application = z.infer<typeof Application>

export const Applications = z.array(Application).superRefine((apps, ctx) => {
  const ids = new Set<string>()
  const origins = new Set<string>()
  let landings = 0
  for (const [index, app] of apps.entries()) {
    if (ids.has(app.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `Application id "${app.id}" is declared twice`,
      })
    }
    ids.add(app.id)
    if (app.kind !== 'first-party') continue
    if (origins.has(app.origin)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'origin'],
        message: `Origin ${app.origin} belongs to two applications`,
      })
    }
    origins.add(app.origin)
    if (app.landing) landings++
  }
  if (landings > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'At most one first-party application can be the landing app',
    })
  }
})

/** The app sign-in lands on: the one marked `landing`, else the first first-party app. */
export function landingApplication(
  apps: readonly Application[],
): FirstPartyApplication | undefined {
  const firstParty = apps.filter((app): app is FirstPartyApplication =>
    app.kind === 'first-party'
  )
  return firstParty.find((app) => app.landing) ?? firstParty[0]
}
