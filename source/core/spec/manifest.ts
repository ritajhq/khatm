import { z } from 'zod'
import { AuthSpec } from './auth-spec.ts'
import { BrandingSpec } from './branding.ts'

/**
 * Users created on first boot only, such as portal's first admin. Later
 * edits are ignored, so it stays out of the digest.
 */
export const BootstrapSpec = z.object({
  users: z.array(
    z.object({
      email: z.email(),
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
