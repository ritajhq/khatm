import { z } from 'zod'
import { Applications } from './application.ts'
import { DatabaseSpec } from './database.ts'
import { isWithinDomain, Origin } from './origin.ts'
import { CapabilityRef, PluginSpecs } from './plugin.ts'
import { SecretRef, Secrets } from './secret.ts'
import { SessionContract } from './session-contract.ts'

const ProviderId = z.string().regex(/^[a-z][a-z0-9-]*$/)

/** Everything `betterAuth()` is built from, as data: no functions, no secret values. */
export const AuthSpec = z.object({
  baseURL: Origin,
  secrets: Secrets,
  database: DatabaseSpec,
  emailAndPassword: z.object({
    enabled: z.boolean(),
    requireVerification: z.boolean().optional(),
  }).strict().optional(),
  socialProviders: z.record(
    ProviderId,
    z.object({ clientId: SecretRef, clientSecret: SecretRef }).strict(),
  ).default({}),
  plugins: PluginSpecs.default([]),
  hooks: z.array(CapabilityRef).default([]),
  applications: Applications.default([]),
  session: SessionContract,
}).strict().superRefine((auth, ctx) => {
  const domain = auth.session.cookieDomain
  if (domain === undefined) return

  // The cookie only reaches hosts under its domain, so the auth server and
  // every app sharing it must live there.
  if (!isWithinDomain(new URL(auth.baseURL).hostname, domain)) {
    ctx.addIssue({
      code: 'custom',
      path: ['baseURL'],
      message: `${auth.baseURL} is outside the cookie domain ${domain}`,
    })
  }
  for (const [index, app] of auth.applications.entries()) {
    if (app.kind !== 'first-party') continue
    if (!isWithinDomain(new URL(app.origin).hostname, domain)) {
      ctx.addIssue({
        code: 'custom',
        path: ['applications', index, 'origin'],
        message: `${app.origin} is outside the cookie domain ${domain}`,
      })
    }
  }
})
export type AuthSpec = z.infer<typeof AuthSpec>
