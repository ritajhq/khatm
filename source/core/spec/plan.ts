import { canonicalize } from './canonical.ts'
import type { Json } from './json.ts'
import {
  digestOf,
  type ManifestDigest,
  type ResolvedManifest,
} from './resolve.ts'

/** How disruptive a change is, from least to most. */
export type ChangeImpact =
  | 'hot'
  | 'restart'
  | 'migration'
  | 'manual'
  | 'destructive'

const SEVERITY: readonly ChangeImpact[] = [
  'hot',
  'restart',
  'migration',
  'manual',
  'destructive',
]

export interface PlanStep {
  /** `auth.plugins[admin]`, `derived[trustedOrigins]`, `secret[env:AUTH_SECRET]` */
  readonly path: string
  /** Absent when the step adds something. */
  readonly before?: Json
  /** Absent when the step removes something. */
  readonly after?: Json
  readonly impact: ChangeImpact
  readonly reason: string
  /** Set on derived entries: what the operator actually changed. */
  readonly derivedFrom?: string
}

/** Fingerprints of resolved secret values, keyed by `secretRefKey()`. */
export type SecretFingerprints = Readonly<Record<string, string>>

export class Plan {
  constructor(
    /** The active manifest this plan was computed against; absent on first apply. */
    readonly base: ManifestDigest | undefined,
    readonly desired: ManifestDigest,
    readonly steps: readonly PlanStep[],
  ) {}

  get isEmpty(): boolean {
    return this.steps.length === 0
  }

  /** The most disruptive step's impact; `hot` for an empty plan. */
  get impact(): ChangeImpact {
    return this.steps.reduce<ChangeImpact>(
      (worst, step) =>
        SEVERITY.indexOf(step.impact) > SEVERITY.indexOf(worst)
          ? step.impact
          : worst,
      'hot',
    )
  }

  /** Destructive steps need the operator's explicit confirmation. */
  get needsConfirmation(): boolean {
    return this.steps.some((step) => step.impact === 'destructive')
  }

  /** Manual steps block the apply until the operator has done them. */
  get isBlocked(): boolean {
    return this.steps.some((step) => step.impact === 'manual')
  }
}

/**
 * Diffs two resolved manifests and classifies each change. Secret values
 * are invisible to the manifests, so a value that changed behind the same
 * reference only shows up through the fingerprints.
 */
export async function plan(
  current: ResolvedManifest | undefined,
  desired: ResolvedManifest,
  fingerprints?: { current: SecretFingerprints; desired: SecretFingerprints },
): Promise<Plan> {
  const changes: Change[] = []
  diff(
    current === undefined ? undefined : toJson(current),
    toJson(desired),
    '',
    changes,
  )

  const steps: PlanStep[] = changes.map((change) => ({
    ...change,
    ...classify(change, newestVersion(current)),
    ...derivedFrom(change, current, desired),
  }))

  if (fingerprints) {
    for (const [ref, after] of Object.entries(fingerprints.desired)) {
      const before = fingerprints.current[ref]
      if (before === undefined || before === after) continue
      steps.push({
        path: `secret[${ref}]`,
        impact: 'destructive',
        reason:
          'The value behind this reference changed; anything the old value signed or encrypted stops verifying',
      })
    }
  }

  return new Plan(
    current === undefined ? undefined : await digestOf(current),
    await digestOf(desired),
    steps,
  )
}

interface Change {
  path: string
  before?: Json
  after?: Json
}

/** Collections whose elements are compared by key, not by position. */
const KEYED: Readonly<Record<string, string>> = {
  'auth.secrets': 'version',
  'auth.plugins': 'kind',
  'auth.hooks': 'name',
  'auth.applications': 'id',
}

function toJson(resolved: ResolvedManifest): Json {
  const derived: Record<string, Json> = {}
  for (const [path, entry] of Object.entries(resolved.derived)) {
    derived[path] = entry.value
  }
  return JSON.parse(
    canonicalize({
      auth: resolved.auth,
      branding: resolved.branding,
      derived,
    }),
  )
}

function diff(
  before: Json | undefined,
  after: Json | undefined,
  path: string,
  changes: Change[],
): void {
  if (before === undefined && after === undefined) return
  if (before === undefined || after === undefined) {
    changes.push(
      before === undefined ? { path, after } : { path, before },
    )
    return
  }

  const key = KEYED[path]
  if (key !== undefined && Array.isArray(before) && Array.isArray(after)) {
    diffObjects(byKey(before, key), byKey(after, key), (k) => `${path}[${k}]`)
    return
  }
  if (path === 'derived' && isObject(before) && isObject(after)) {
    diffLeaves(before, after, (k) => `derived[${k}]`)
    return
  }
  if (isObject(before) && isObject(after)) {
    diffObjects(before, after, (k) => path === '' ? k : `${path}.${k}`)
    return
  }
  if (canonicalize(before) !== canonicalize(after)) {
    changes.push({ path, before, after })
  }

  function diffObjects(
    a: Record<string, Json>,
    b: Record<string, Json>,
    child: (key: string) => string,
  ): void {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff(a[k], b[k], child(k), changes)
    }
  }

  // Derived entries are compared whole: their paths already contain dots.
  function diffLeaves(
    a: Record<string, Json>,
    b: Record<string, Json>,
    child: (key: string) => string,
  ): void {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const [x, y] = [a[k], b[k]]
      if (x === undefined || y === undefined) {
        diff(x, y, child(k), changes)
      } else if (canonicalize(x) !== canonicalize(y)) {
        changes.push({ path: child(k), before: x, after: y })
      }
    }
  }
}

function byKey(items: Json[], key: string): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const item of items) {
    if (isObject(item)) out[String(item[key])] = item
  }
  return out
}

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function derivedFrom(
  change: Change,
  current: ResolvedManifest | undefined,
  desired: ResolvedManifest,
): { derivedFrom?: string } {
  const match = /^derived\[(.+)\]$/.exec(change.path)
  if (match === null) return {}
  const entry = desired.derived[match[1]] ?? current?.derived[match[1]]
  return entry ? { derivedFrom: entry.derivedFrom } : {}
}

function newestVersion(resolved: ResolvedManifest | undefined): number {
  return Math.max(0, ...(resolved?.auth.secrets ?? []).map((s) => s.version))
}

function classify(
  change: Change,
  newest: number,
): { impact: ChangeImpact; reason: string } {
  const { path, before, after } = change
  const added = before === undefined
  const removed = after === undefined

  if (path === 'branding' || path.startsWith('branding.')) {
    return { impact: 'hot', reason: 'Branding applies without a restart' }
  }
  if (/^auth\.secrets\[[^\]]+\]$/.test(path)) {
    return removed
      ? {
        impact: 'destructive',
        reason:
          'Removing a secret version invalidates what it signed, logging those sessions out',
      }
      : added
      ? Number(/\[([^\]]+)\]/.exec(path)![1]) > newest && newest > 0
        ? {
          impact: 'destructive',
          reason:
            'The new version signs session cookies from now on and Better Auth verifies cookies with the current version only, so everyone is logged out (encrypted data stays readable)',
        }
        : {
          impact: 'restart',
          reason:
            'A version that is not the newest is only used to decrypt older data',
        }
      : changedSecret()
  }
  if (path.startsWith('auth.secrets[')) return changedSecret()
  if (/^(auth\.plugins\[[^\]]+\]|derived\[plugins\.[^\]]+\])$/.test(path)) {
    if (removed) {
      return {
        impact: 'destructive',
        reason: "The plugin's tables stay but go unused, orphaning their data",
      }
    }
    if (added) {
      return {
        impact: 'migration',
        reason: 'A new plugin can add tables or columns',
      }
    }
  }
  if (/^auth\.applications\[[^\]]+\]$/.test(path) && removed) {
    const kind = (before as { kind?: unknown } | undefined)?.kind
    if (kind === 'oauth') {
      return {
        impact: 'destructive',
        reason:
          "The app's client is deleted, so it can no longer sign anyone in or refresh its tokens",
      }
    }
  }
  if (
    path === 'auth.session.cookieDomain' ||
    path === 'derived[advanced.crossSubDomainCookies]'
  ) {
    return {
      impact: 'destructive',
      reason: 'Changing the cookie domain logs everyone out',
    }
  }
  if (path === 'auth.session.claims') {
    const kept = new Set(Array.isArray(after) ? after : [])
    const dropped = (Array.isArray(before) ? before : []).filter((claim) =>
      !kept.has(claim)
    )
    return dropped.length > 0
      ? {
        impact: 'destructive',
        reason: `Guards lose the ${dropped.join(', ')} claim${
          dropped.length > 1 ? 's' : ''
        } their policies may read`,
      }
      : { impact: 'restart', reason: 'Guards receive the new claims' }
  }
  if (path.startsWith('auth.session.')) {
    return {
      impact: 'destructive',
      reason:
        'Guards are configured with the old value and stop recognizing sessions',
    }
  }
  if (path === 'auth.baseURL') {
    const scheme = (url: Json | undefined) =>
      typeof url === 'string' ? new URL(url).protocol : undefined
    return scheme(before) !== scheme(after)
      ? {
        impact: 'destructive',
        reason:
          'Switching between http and https renames the session cookie (__Secure- prefix), logging everyone out',
      }
      : { impact: 'restart', reason: 'The auth server moves to a new address' }
  }
  if (path === 'auth.database' || path.startsWith('auth.database.')) {
    return {
      impact: 'destructive',
      reason: 'The auth server would read and write a different database',
    }
  }
  return {
    impact: 'restart',
    reason: 'Takes effect when the new worker starts',
  }

  function changedSecret(): { impact: ChangeImpact; reason: string } {
    return {
      impact: 'destructive',
      reason:
        'The version now points at a different secret; what the old one signed stops verifying',
    }
  }
}
