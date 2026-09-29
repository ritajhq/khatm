import {
  canonicalize,
  digestOf,
  type Json,
  plan,
  type PlanStep,
  type ResolvedManifest,
  type SecretFingerprints,
  secretRefKey,
} from '@khatm/spec'
import { ejectAuth } from './eject.ts'

/** What a bundle is built from. Structural, so the bundle knows nothing of how state is stored. */
export interface BundleInput {
  readonly revision: {
    readonly id: string
    readonly parent?: string
    readonly manifest: string
    readonly author: string
    readonly reason?: string
    readonly createdAt: Date
  }
  readonly resolved: ResolvedManifest
  readonly fingerprints: SecretFingerprints
  readonly authored?: Json
  /** The revision this one replaced, for `plan.md`. */
  readonly parent?: {
    readonly resolved: ResolvedManifest
    readonly fingerprints: SecretFingerprints
  }
  readonly versions: {
    betterAuth: string
    /** Bumped when the registry's schemas change shape. */
    registrySchema: number
    /** The orchestrator image digest, when running from one. */
    image?: string
  }
}

/** Bundle path to file content. Deterministic: the same input gives the same files. */
export type Bundle = Readonly<Record<string, string>>

function pretty(value: unknown): string {
  return JSON.stringify(JSON.parse(canonicalize(value)), null, 2) + '\n'
}

/** Every secret the manifest references, with what it is for. */
export function secretsRequired(
  resolved: ResolvedManifest,
): { ref: string; description: string }[] {
  const { auth } = resolved
  const entries = new Map<string, string>()
  const add = (ref: Parameters<typeof secretRefKey>[0], text: string) => {
    const key = secretRefKey(ref)
    entries.set(key, entries.has(key) ? `${entries.get(key)}; ${text}` : text)
  }
  for (const s of auth.secrets) {
    add(s.value, `Better Auth signing secret, version ${s.version}`)
  }
  add(auth.database.url, `${auth.database.dialect} connection`)
  for (const [id, c] of Object.entries(auth.socialProviders)) {
    add(c.clientId, `${id} OAuth client id`)
    add(c.clientSecret, `${id} OAuth client secret`)
  }
  return [...entries].map(([ref, description]) => ({ ref, description }))
}

export async function buildBundle(input: BundleInput): Promise<Bundle> {
  const { revision, resolved } = input
  const digest = await digestOf(resolved)
  if (digest !== revision.manifest) {
    throw new BundleMismatchError(revision.id, revision.manifest, digest)
  }
  const required = secretsRequired(resolved)

  const files: Record<string, string> = {
    'manifest.json': pretty(resolved),
    'revision.json': pretty({
      id: revision.id,
      parent: revision.parent,
      manifest: revision.manifest,
      author: revision.author,
      reason: revision.reason,
      createdAt: revision.createdAt.toISOString(),
    }),
    'lock.json': pretty({
      manifest: revision.manifest,
      betterAuth: input.versions.betterAuth,
      registrySchema: input.versions.registrySchema,
      image: input.versions.image,
      plugins: [
        ...resolved.auth.plugins.map((p) => p.kind),
        ...Object.keys(resolved.derived).filter((p) => p.startsWith('plugins.'))
          .map((p) => p.slice('plugins.'.length)),
      ].sort(),
      secretFingerprints: input.fingerprints,
    }),
    'secrets.required.json': pretty(required),
    '.env.example': required.map((r) =>
      `# ${r.description}\n${
        r.ref.startsWith('env:') ? r.ref.slice(4) : `# file: ${r.ref.slice(5)}`
      }=\n`
    ).join('\n'),
    'branding/tokens.json': pretty(resolved.branding.tokens),
    'branding/messages.json': pretty(resolved.branding.messages),
    'plan.md': await planMarkdown(input),
    'auth.ts': ejectAuth(resolved, {
      revision: revision.id,
      manifest: revision.manifest,
    }),
  }
  if (input.authored !== undefined) {
    files['manifest.authored.json'] = pretty(input.authored)
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  )
}

async function planMarkdown(input: BundleInput): Promise<string> {
  const { revision, parent, resolved, fingerprints } = input
  const title = `# Revision ${revision.id}\n\n`
  if (!parent) return `${title}First revision: nothing to compare against.\n`
  const result = await plan(
    parent.resolved,
    resolved,
    { current: parent.fingerprints, desired: fingerprints },
  )
  if (result.isEmpty) {
    return `${title}No changes from revision ${revision.parent}.\n`
  }
  const rows = result.steps.map((s: PlanStep) =>
    `| ${s.impact} | \`${s.path || '(whole manifest)'}\` | ${s.reason} |`
  )
  return `${title}Changes from revision ${revision.parent} (${result.impact}):\n\n| Impact | Path | Why |\n| --- | --- | --- |\n${
    rows.join('\n')
  }\n`
}

export class BundleMismatchError extends Error {
  constructor(revision: string, expected: string, actual: string) {
    super(
      `Revision ${revision} says its manifest is ${expected}, but the resolved manifest hashes to ${actual}`,
    )
  }
}

/** Checks that a bundle's manifest, revision and lock agree with each other. */
export async function verifyBundle(bundle: Bundle): Promise<string[]> {
  const problems: string[] = []
  const read = (path: string) => {
    if (!(path in bundle)) {
      problems.push(`${path} is missing`)
      return undefined
    }
    return JSON.parse(bundle[path])
  }
  const manifest = read('manifest.json')
  const revision = read('revision.json')
  const lock = read('lock.json')
  if (manifest && revision) {
    const digest = await digestOf(manifest)
    if (digest !== revision.manifest) {
      problems.push(
        `manifest.json hashes to ${digest}, revision.json says ${revision.manifest}`,
      )
    }
  }
  if (lock && revision && lock.manifest !== revision.manifest) {
    problems.push('lock.json was written for a different manifest')
  }
  return problems
}
