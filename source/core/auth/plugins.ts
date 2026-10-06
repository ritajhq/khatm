import type { BetterAuthPlugin } from 'better-auth'
import { admin, jwt, username } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { ClientSecretHash } from './client-secret.ts'

type Factory = (options: Record<string, unknown>) => BetterAuthPlugin

/**
 * How each registry plugin kind becomes a real Better Auth plugin. The
 * registry (`@khatm/registry`) holds what an operator may write for it;
 * this holds what it takes to build it, so `better-auth` is only imported
 * here.
 */
const FACTORIES: Readonly<Record<string, Factory>> = {
  username: (options) => username(options),
  admin: (options) => admin(options),
  jwt: (options) => jwt(options),
  'oauth-provider': (options) =>
    oauthProvider({
      ...(options as unknown as Parameters<typeof oauthProvider>[0]),
      storeClientSecret: new ClientSecretHash(),
    }) as unknown as BetterAuthPlugin,
}

export class UnknownPluginError extends Error {
  constructor(readonly kind: string) {
    super(`No factory for plugin "${kind}"`)
  }
}

export function buildPlugin(
  kind: string,
  options: Record<string, unknown>,
): BetterAuthPlugin {
  const factory = FACTORIES[kind]
  if (factory === undefined) throw new UnknownPluginError(kind)
  return factory(options)
}
