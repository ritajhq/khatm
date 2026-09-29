import { betterAuth, type BetterAuthOptions } from 'better-auth'
import type { ResolvedManifest } from '@khatm/spec'
import { openDatabase } from './database.ts'
import { buildPlugin } from './plugins.ts'
import { processSecrets, resolveSecret, type SecretSource } from './secrets.ts'

export class UnknownCapabilityError extends Error {
  constructor(readonly names: string[]) {
    super(`No capability registry entry for: ${names.join(', ')}`)
  }
}

export type Auth = ReturnType<typeof betterAuth<BetterAuthOptions>>

export interface CreatedAuth {
  readonly auth: Auth
  /** Releases the database connection. */
  close(): Promise<void>
}

/**
 * Builds the `betterAuth()` instance a resolved manifest describes. Nothing
 * reaches it that isn't in the manifest: trusted origins, cookie domain and
 * derived plugins all arrive through `resolved.derived`.
 */
export function createAuth(
  resolved: ResolvedManifest,
  source: SecretSource = processSecrets,
  options: { quiet?: boolean } = {},
): CreatedAuth {
  const spec = resolved.auth
  if (spec.hooks.length > 0) {
    throw new UnknownCapabilityError(spec.hooks.map((hook) => hook.name))
  }

  // The first entry signs; the rest only verify, so the newest goes first.
  const secrets = [...spec.secrets]
    .sort((a, b) => b.version - a.version)
    .map((secret) => ({
      version: secret.version,
      value: resolveSecret(secret.value, source),
    }))

  const socialProviders = Object.fromEntries(
    Object.entries(spec.socialProviders).map(([id, credentials]) => [
      id,
      {
        clientId: resolveSecret(credentials.clientId, source),
        clientSecret: resolveSecret(credentials.clientSecret, source),
      },
    ]),
  )

  const derivedPlugins = Object.keys(resolved.derived)
    .filter((path) => path.startsWith('plugins.'))
    .sort()
    .map((path) =>
      resolved.derived[path].value as {
        kind: string
        options: Record<string, unknown>
      }
    )

  const trustedOrigins = resolved.derived['trustedOrigins']?.value as
    | string[]
    | undefined
  const crossSubDomainCookies = resolved
    .derived['advanced.crossSubDomainCookies']?.value as
      | { enabled: boolean; domain: string }
      | undefined

  const database = openDatabase(
    spec.database,
    resolveSecret(spec.database.url, source),
  )

  const config: BetterAuthOptions = {
    baseURL: spec.baseURL,
    secrets,
    database: database.database as never,
    trustedOrigins,
    emailAndPassword: spec.emailAndPassword === undefined ? undefined : {
      enabled: spec.emailAndPassword.enabled,
      requireEmailVerification: spec.emailAndPassword.requireVerification,
    },
    socialProviders,
    plugins: [
      ...spec.plugins.map((plugin) => buildPlugin(plugin.kind, plugin.options)),
      ...derivedPlugins.map((plugin) =>
        buildPlugin(plugin.kind, plugin.options)
      ),
    ],
    advanced: crossSubDomainCookies === undefined
      ? undefined
      : { crossSubDomainCookies },
    logger: options.quiet ? { disabled: true } : undefined,
  }

  return { auth: betterAuth(config), close: () => database.close() }
}
