import type { ManifestDigest } from './resolve.ts'

/**
 * The history event of someone applying a manifest: git's commit to the
 * manifest's tree. Its id is unique per event, so a rollback is a new
 * revision pointing at an older manifest, not a collision with it.
 */
export class Revision {
  private constructor(
    readonly id: string,
    readonly parent: string | undefined,
    readonly manifest: ManifestDigest,
    readonly createdAt: Date,
    /** idhn's subject for the caller, or `socket`. */
    readonly author: string,
    readonly reason: string | undefined,
  ) {}

  static create(input: {
    parent?: string
    manifest: ManifestDigest
    author: string
    reason?: string
    id?: string
    createdAt?: Date
  }): Revision {
    if (input.author.trim().length === 0) {
      throw new InvalidRevisionError('A revision needs an author')
    }
    if (!input.manifest.startsWith('sha256:')) {
      throw new InvalidRevisionError(
        `Not a manifest digest: ${input.manifest}`,
      )
    }
    return new Revision(
      input.id ?? crypto.randomUUID(),
      input.parent,
      input.manifest,
      input.createdAt ?? new Date(),
      input.author,
      input.reason,
    )
  }
}

export class InvalidRevisionError extends Error {}
