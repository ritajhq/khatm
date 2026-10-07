import { z } from 'zod'
import { AuthSpec } from './auth-spec.ts'
import { BrandingSpec } from './branding.ts'
import { placeable } from './env-ref.ts'

/**
 * Users created on first boot only, such as portal's first admin. Later
 * edits are ignored, so it stays out of the digest.
 */
export const BootstrapSpec = z.object({
  users: z.array(
    z.object({
      // From the environment, a user is only created where it is set: a dev
      // admin in development, none in production.
      email: placeable(z.email()),
      name: z.string().min(1),
      role: z.string().min(1).optional(),
    }).strict(),
  ),
}).strict()
export type BootstrapSpec = z.infer<typeof BootstrapSpec>

/** What an operator writes: the authored manifest. */
export const Manifest = z.object({
  auth: AuthSpec,
  branding: BrandingSpec.default({ tokens: {}, messages: {} }),
  bootstrap: BootstrapSpec.optional(),
}).strict()
export type Manifest = z.infer<typeof Manifest>

/** Parses an authored manifest, filling defaults, or says everything wrong with it. */
export function parseManifest(input: unknown): Manifest {
  const result = Manifest.safeParse(input)
  if (!result.success) {
    throw new InvalidManifestError(
      result.error.issues.map((issue) =>
        `${issue.path.join('.') || '(manifest)'}: ${issue.message}`
      ),
    )
  }
  return result.data
}

export class InvalidManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid manifest:\n${problems.map((p) => `- ${p}`).join('\n')}`)
  }
}
