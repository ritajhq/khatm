import type {
  Json,
  ManifestDigest,
  ResolvedManifest,
  Revision,
  SecretFingerprints,
} from '@khatm/spec'

/** What Better Auth's migrator would change; mirrors `@khatm/auth`. */
export interface MigrationPlan {
  readonly created: string[]
  readonly added: { table: string; fields: string[] }[]
  readonly unsafe: string[]
}

/** A revision together with what it was resolved to, as recorded. */
export interface ActiveState {
  readonly revision: Revision
  readonly resolved: ResolvedManifest
  readonly fingerprints: SecretFingerprints
  /** What the operator wrote, as JSON; absent for states recorded before it was kept. */
  readonly authored?: Json
}

/** Durable history. `activate` is a compare-and-swap on the active revision. */
export interface RevisionStore {
  active(): Promise<ActiveState | undefined>
  /** Looks up any past state, for rollback. */
  find(revisionId: string): Promise<ActiveState | undefined>
  /** Throws `StaleBaseError` unless `expectedActive` is still the active revision id. */
  activate(
    state: ActiveState,
    expectedActive: string | undefined,
  ): Promise<void>
}

export interface Lease {
  release(): Promise<void>
}

/** At most one apply at a time, across orchestrator instances. */
export interface ApplyLock {
  acquire(owner: string): Promise<Lease | undefined>
}

/** One running Better Auth process. */
export interface Worker {
  readonly id: string
  /** `http://127.0.0.1:PORT` */
  readonly upstream: string
  readonly alive: boolean
  /** Resolves when the process ends, whatever the reason. */
  readonly exited: Promise<void>
  /** Recent output, for the failure message. */
  readonly output: string
  stop(graceMs?: number): Promise<void>
}

export interface Workers {
  start(resolved: ResolvedManifest): Promise<Worker>
}

export interface Traffic {
  switchTo(upstream: string): void
  /** Resolves once nothing is in flight to `upstream`, or the timeout passed. */
  drain(upstream: string, timeoutMs: number): Promise<void>
}

export interface Migrator {
  plan(resolved: ResolvedManifest): Promise<MigrationPlan>
  run(resolved: ResolvedManifest): Promise<void>
}

export interface SecretResolver {
  /** Throws when a referenced secret is unset or empty; returns its fingerprints. */
  fingerprints(resolved: ResolvedManifest): Promise<SecretFingerprints>
}

/** Writes the reproducibility artifacts for a revision before it goes live. */
export interface Artifacts {
  write(state: ActiveState): Promise<void>
  /** Called once the revision is live, to point `current` at it. */
  activated?(state: ActiveState): Promise<void>
}

export type DeploymentEvent =
  | { type: 'apply.started'; revision: string; base: string | undefined }
  | { type: 'apply.migrated'; revision: string; migration: MigrationPlan }
  | { type: 'apply.unhealthy'; revision: string; failures: string[] }
  | { type: 'apply.activated'; revision: string; manifest: ManifestDigest }
  | { type: 'apply.failed'; revision: string; error: string }
  | { type: 'worker.crashed'; worker: string; output: string }
  | { type: 'worker.restarted'; worker: string }

export interface EventSink {
  emit(event: DeploymentEvent): void
}

export class StaleBaseError extends Error {}
