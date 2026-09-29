import { betterAuthVersion } from '@khatm/auth'
import { buildBundle, type Bundle } from '@khatm/bundle'
import type { ActiveState, RevisionStore } from '@khatm/deployment'
import { REGISTRY_SCHEMA_VERSION } from '@khatm/registry'

/** Builds a revision's reproducibility bundle from what the store recorded. */
export class Bundles {
  constructor(
    private readonly store: Pick<RevisionStore, 'find'>,
    private readonly image: string | undefined = Deno.env.get(
      'KHATM_IMAGE_DIGEST',
    ),
  ) {}

  async build(state: ActiveState): Promise<Bundle> {
    const parent = state.revision.parent === undefined
      ? undefined
      : await this.store.find(state.revision.parent)
    return await buildBundle({
      revision: state.revision,
      resolved: state.resolved,
      fingerprints: state.fingerprints,
      authored: state.authored,
      parent: parent && {
        resolved: parent.resolved,
        fingerprints: parent.fingerprints,
      },
      versions: {
        betterAuth: betterAuthVersion(),
        registrySchema: REGISTRY_SCHEMA_VERSION,
        image: this.image,
      },
    })
  }
}
