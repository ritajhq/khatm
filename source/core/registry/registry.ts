import {
  type Derivation,
  digestOf,
  type Manifest,
  type ManifestDigest,
  resolve,
  type ResolvedManifest,
} from '@khatm/spec'
import {
  fromAdministration,
  fromApplications,
  fromCookieDomain,
} from './derivations.ts'
import type { PluginDefinition } from './plugin-definition.ts'
import { admin, CORE_USER_FIELDS, username } from './plugins.ts'

/**
 * The plugins khatm knows how to build and the rules that expand an
 * authored manifest. A manifest is only as valid as the registry it is
 * resolved against, which is why the registry version goes in the lock.
 */
export class Registry {
  private readonly plugins: ReadonlyMap<string, PluginDefinition>

  constructor(
    plugins: readonly PluginDefinition[],
    private readonly derivations: readonly Derivation[],
  ) {
    this.plugins = new Map(plugins.map((plugin) => [plugin.kind, plugin]))
  }

  /** Every plugin kind the registry knows, in name order. */
  list(): PluginDefinition[] {
    return [...this.plugins.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind)
    )
  }

  plugin(kind: string): PluginDefinition | undefined {
    return this.plugins.get(kind)
  }

  /**
   * Expands the manifest and checks it against the registry: known plugin
   * kinds with valid options, and claims that some installed plugin
   * provides.
   */
  resolve(manifest: Manifest): ResolvedManifest {
    const problems: string[] = []

    for (const [index, spec] of manifest.auth.plugins.entries()) {
      const definition = this.plugins.get(spec.kind)
      const path = `auth.plugins.${index}`
      if (definition === undefined) {
        problems.push(`${path}: Unknown plugin "${spec.kind}"`)
        continue
      }
      if (!definition.authorable) {
        problems.push(
          `${path}: "${spec.kind}" is derived by khatm and can't be written by hand`,
        )
        continue
      }
      const options = definition.options.safeParse(spec.options)
      if (!options.success) {
        for (const issue of options.error.issues) {
          problems.push(
            `${[path, 'options', ...issue.path].join('.')}: ${issue.message}`,
          )
        }
      }
    }
    if (problems.length > 0) throw new UnresolvableManifestError(problems)

    const resolved = resolve(manifest, this.derivations)

    const fields = new Set(CORE_USER_FIELDS)
    for (const kind of this.installedPlugins(resolved)) {
      for (const field of this.plugins.get(kind)?.userFields ?? []) {
        fields.add(field)
      }
    }
    for (const claim of manifest.auth.session.claims) {
      if (!fields.has(claim)) {
        problems.push(
          `auth.session.claims: No installed plugin provides the "${claim}" field`,
        )
      }
    }
    if (problems.length > 0) throw new UnresolvableManifestError(problems)

    return resolved
  }

  /** Resolves and hashes in one go: the manifest's identity under this registry. */
  digest(manifest: Manifest): Promise<ManifestDigest> {
    return digestOf(this.resolve(manifest))
  }

  private installedPlugins(resolved: ResolvedManifest): string[] {
    const derived = Object.keys(resolved.derived)
      .filter((path) => path.startsWith('plugins.'))
      .map((path) => path.slice('plugins.'.length))
    return [...resolved.auth.plugins.map((plugin) => plugin.kind), ...derived]
  }
}

export class UnresolvableManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Manifest can't be resolved:\n${
        problems.map((p) => `- ${p}`).join('\n')
      }`,
    )
  }
}

/** The first registry: portal's plugins and the derivations they need. */
export function defaultRegistry(): Registry {
  return new Registry(
    [username, admin],
    [fromApplications, fromCookieDomain, fromAdministration],
  )
}
