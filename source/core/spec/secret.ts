import { z } from 'zod'

/**
 * Where a secret's value comes from. A manifest only ever holds the
 * reference, never the value, so it can be committed and diffed safely.
 */
export const SecretRef = z.union([
  z.object({ env: z.string().min(1) }).strict(),
  z.object({ file: z.string().min(1) }).strict(),
])
export type SecretRef = z.infer<typeof SecretRef>

/** A stable name for a reference, used to key fingerprints: `env:AUTH_SECRET`. */
export function secretRefKey(ref: SecretRef): string {
  return 'env' in ref ? `env:${ref.env}` : `file:${ref.file}`
}

/**
 * One version of Better Auth's signing secret. The newest version signs,
 * older ones still verify, so rotating is adding a version.
 */
export const VersionedSecret = z.object({
  version: z.number().int().positive(),
  value: SecretRef,
}).strict()
export type VersionedSecret = z.infer<typeof VersionedSecret>

export const Secrets = z.array(VersionedSecret).min(1).superRefine(
  (secrets, ctx) => {
    const seen = new Set<number>()
    for (const [index, secret] of secrets.entries()) {
      if (seen.has(secret.version)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'version'],
          message: `Secret version ${secret.version} is declared twice`,
        })
      }
      seen.add(secret.version)
    }
  },
)
