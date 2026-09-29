import type { BetterAuthPlugin } from 'better-auth'
import { admin, username } from 'better-auth/plugins'

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
