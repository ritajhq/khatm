import type { Placed } from './env-ref.ts'
import type { AuthSpec } from './auth-spec.ts'
import type { BrandingSpec } from './branding.ts'
import { sha256 } from './canonical.ts'
import type { Json } from './json.ts'
import type { Manifest } from './manifest.ts'

/**
 * An entry khatm adds on its own, such as the trusted origins it derives
 * from the applications. `derivedFrom` names what it came from, so a plan
 * can say why it changed.
 */
export interface Derived {
  readonly value: Json
  readonly derivedFrom: string
}

/**
 * A rule that expands an authored manifest. Rules live in the registry;
 * each returns the entries it derives, keyed by their path in the resolved
 * config (`trustedOrigins`, `plugins.admin`).
 */
export interface Derivation {
  derive(manifest: Manifest): Record<string, Derived>
}

/**
 * The authored manifest plus everything derived from it: what the worker is
 * built from, what the digest covers and what `plan` diffs. The bootstrap
 * block is left out because it only matters on first boot.
 */
export interface ResolvedManifest {
  readonly auth: AuthSpec
  readonly branding: BrandingSpec
  readonly derived: Readonly<Record<string, Derived>>
}

/** A hash of a resolved manifest's canonical serialization. */
export type ManifestDigest = string

export function resolve(
  manifest: Manifest,
  derivations: readonly Derivation[],
): ResolvedManifest {
  const derived: Record<string, Derived> = {}
  const authoredPlugins = new Set(manifest.auth.plugins.map((p) => p.kind))

  for (const derivation of derivations) {
    for (const [path, entry] of Object.entries(derivation.derive(manifest))) {
      if (path in derived) {
        throw new ConflictingDerivationError(
          `"${path}" is derived from both ${
            derived[path].derivedFrom
          } and ${entry.derivedFrom}`,
        )
      }
      const plugin = path.startsWith('plugins.') ? path.slice(8) : undefined
      if (plugin !== undefined && authoredPlugins.has(plugin)) {
        throw new ConflictingDerivationError(
          `Plugin "${plugin}" is derived from ${entry.derivedFrom}; remove it from auth.plugins`,
        )
      }
      derived[path] = entry
    }
  }

  return { auth: manifest.auth, branding: manifest.branding, derived }
}

export function digestOf(resolved: ResolvedManifest): Promise<ManifestDigest> {
  return sha256(resolved)
}

export class ConflictingDerivationError extends Error {}

/**
 * A resolved manifest placed in one deployment: every `EnvRef` read, and
 * everything derived from them derived again from what was read. What a
 * worker, the hosted pages and the guard manifests are built from.
 */
export type PlacedManifest = Placed<ResolvedManifest>
