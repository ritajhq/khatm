import {
  type Json,
  type ManifestDigest,
  Plan,
  plan,
  type PlanStep,
  type ResolvedManifest,
  Revision,
  type SecretFingerprints,
} from '@khatm/spec'
import { type HealthOptions, waitHealthy } from './health.ts'
import {
  type ActiveState,
  type ApplyLock,
  type Artifacts,
  type EventSink,
  type MigrationPlan,
  type Migrator,
  type RevisionStore,
  type SecretResolver,
  StaleBaseError,
  type Traffic,
  type Worker,
  type Workers,
} from './ports.ts'

export interface DeploymentPorts {
  store: RevisionStore
  lock: ApplyLock
  workers: Workers
  traffic: Traffic
  migrator: Migrator
  secrets: SecretResolver
  artifacts: Artifacts
  events?: EventSink
}

export interface DeploymentOptions {
  health?: HealthOptions
  /** How long in-flight requests get on the old worker before it is stopped. */
  drainMs?: number
  /** Delays between attempts to restart a crashed worker. */
  restartDelaysMs?: number[]
}

/** A plan bound to the revision it was computed against. */
export interface PlannedApply {
  /** The active revision id the plan was computed against. */
  readonly base: string | undefined
  readonly resolved: ResolvedManifest
  readonly fingerprints: SecretFingerprints
  readonly migration: MigrationPlan
  readonly plan: Plan
  /** The authored manifest this plan came from, kept with the revision. */
  readonly authored?: Json
}

export interface ApplyRequest {
  author: string
  reason?: string
  /** Required when the plan has destructive steps. */
  confirmed?: boolean
}

export interface ApplyResult {
  readonly revision: Revision
  /** False when the plan was empty and nothing was applied. */
  readonly changed: boolean
}

export class BlockedPlanError extends Error {
  constructor(readonly steps: readonly PlanStep[]) {
    super(
      `Apply refused until the manual steps are done: ${
        steps.map((step) => step.path).join(', ')
      }`,
    )
  }
}
export class ConfirmationRequiredError extends Error {
  constructor(readonly steps: readonly PlanStep[]) {
    super(
      `Destructive changes need confirmation: ${
        steps.map((step) => step.path).join(', ')
      }`,
    )
  }
}
export class ApplyInProgressError extends Error {
  constructor() {
    super('Another apply is running')
  }
}
export class StalePlanError extends Error {
  constructor() {
    super('The active revision changed since this plan was made; plan again')
  }
}
export class UnhealthyWorkerError extends Error {
  constructor(readonly failures: string[]) {
    super(`The new worker did not become healthy: ${failures.join('; ')}`)
  }
}
export class UnknownRevisionError extends Error {}

/**
 * Owns which Better Auth worker serves traffic. Applies are blue/green: the
 * new worker must be healthy before traffic moves, so a bad manifest never
 * takes the old one down.
 */
export class Deployment {
  private serving: { worker: Worker; state: ActiveState } | undefined
  private stopped = false

  constructor(
    private readonly ports: DeploymentPorts,
    private readonly options: DeploymentOptions = {},
  ) {}

  get activeRevision(): Revision | undefined {
    return this.serving?.state.revision
  }

  /** Starts serving whatever was active last, if anything. */
  async boot(): Promise<Revision | undefined> {
    const state = await this.ports.store.active()
    if (!state) return undefined
    const worker = await this.startHealthy(state)
    this.ports.traffic.switchTo(worker.upstream)
    this.serving = { worker, state }
    this.watch(worker, state)
    return state.revision
  }

  async plan(
    desired: ResolvedManifest,
    authored?: Json,
  ): Promise<PlannedApply> {
    const active = await this.ports.store.active()
    const fingerprints = await this.ports.secrets.fingerprints(desired)
    const migration = await this.ports.migrator.plan(desired)
    const config = await plan(
      active?.resolved,
      desired,
      active && { current: active.fingerprints, desired: fingerprints },
    )
    return {
      base: active?.revision.id,
      resolved: desired,
      fingerprints,
      migration,
      authored,
      plan: new Plan(config.base, config.desired, [
        ...config.steps,
        ...migrationSteps(migration),
      ]),
    }
  }

  /** Plans returning to what an earlier revision resolved to. */
  async planRollback(revisionId: string): Promise<PlannedApply> {
    const past = await this.ports.store.find(revisionId)
    if (!past) throw new UnknownRevisionError(revisionId)
    return this.plan(past.resolved, past.authored)
  }

  async apply(
    planned: PlannedApply,
    request: ApplyRequest,
  ): Promise<ApplyResult> {
    const blocked = planned.plan.steps.filter((s) => s.impact === 'manual')
    if (blocked.length > 0) throw new BlockedPlanError(blocked)
    const destructive = planned.plan.steps.filter((s) =>
      s.impact === 'destructive'
    )
    if (destructive.length > 0 && !request.confirmed) {
      throw new ConfirmationRequiredError(destructive)
    }

    const lease = await this.ports.lock.acquire(request.author)
    if (!lease) throw new ApplyInProgressError()
    try {
      const active = await this.ports.store.active()
      if (active?.revision.id !== planned.base) throw new StalePlanError()
      if (active && planned.plan.isEmpty) {
        return { revision: active.revision, changed: false }
      }
      return await this.swap(planned, active, request)
    } finally {
      await lease.release()
    }
  }

  /** Stops supervising and stops the serving worker. */
  async shutdown(): Promise<void> {
    this.stopped = true
    await this.serving?.worker.stop()
    this.serving = undefined
  }

  private async swap(
    planned: PlannedApply,
    active: ActiveState | undefined,
    request: ApplyRequest,
  ): Promise<ApplyResult> {
    const revision = Revision.create({
      parent: active?.revision.id,
      manifest: planned.plan.desired as ManifestDigest,
      author: request.author,
      reason: request.reason,
    })
    const state: ActiveState = {
      revision,
      resolved: planned.resolved,
      fingerprints: planned.fingerprints,
      authored: planned.authored,
    }
    const emit = (event: Parameters<EventSink['emit']>[0]) =>
      this.ports.events?.emit(event)
    emit({ type: 'apply.started', revision: revision.id, base: planned.base })

    let worker: Worker | undefined
    try {
      await this.ports.artifacts.write(state)
      if (
        planned.migration.created.length > 0 ||
        planned.migration.added.length > 0
      ) {
        await this.ports.migrator.run(planned.resolved)
        emit({
          type: 'apply.migrated',
          revision: revision.id,
          migration: planned.migration,
        })
      }
      worker = await this.startHealthy(state)
      const previous = this.serving
      this.ports.traffic.switchTo(worker.upstream)
      try {
        await this.ports.store.activate(state, active?.revision.id)
      } catch (error) {
        if (previous) this.ports.traffic.switchTo(previous.worker.upstream)
        throw error
      }
      this.serving = { worker, state }
      this.watch(worker, state)
      await this.ports.artifacts.activated?.(state).catch(() => {})
      emit({
        type: 'apply.activated',
        revision: revision.id,
        manifest: revision.manifest,
      })
      if (previous) await this.retire(previous.worker)
      return { revision, changed: true }
    } catch (error) {
      if (worker && this.serving?.worker !== worker) await worker.stop()
      if (error instanceof StaleBaseError) throw new StalePlanError()
      if (!(error instanceof UnhealthyWorkerError)) {
        emit({
          type: 'apply.failed',
          revision: revision.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  private async startHealthy(state: ActiveState): Promise<Worker> {
    const worker = await this.ports.workers.start(state.resolved)
    const failures = await waitHealthy(
      worker,
      state.resolved,
      this.options.health,
    )
    if (failures.length > 0) {
      this.ports.events?.emit({
        type: 'apply.unhealthy',
        revision: state.revision.id,
        failures,
      })
      await worker.stop()
      throw new UnhealthyWorkerError(failures)
    }
    return worker
  }

  private async retire(worker: Worker): Promise<void> {
    await this.ports.traffic.drain(
      worker.upstream,
      this.options.drainMs ?? 10_000,
    )
    await worker.stop()
  }

  /** Restarts the serving worker, with backoff, when it dies on its own. */
  private watch(worker: Worker, state: ActiveState): void {
    worker.exited.then(async () => {
      if (this.stopped || this.serving?.worker !== worker) return
      this.ports.events?.emit({
        type: 'worker.crashed',
        worker: worker.id,
        output: worker.output.slice(-500),
      })
      for (const delay of this.options.restartDelaysMs ?? [0, 1_000, 5_000]) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (this.stopped || this.serving?.worker !== worker) return
        try {
          const replacement = await this.startHealthy(state)
          this.ports.traffic.switchTo(replacement.upstream)
          this.serving = { worker: replacement, state }
          this.watch(replacement, state)
          this.ports.events?.emit({
            type: 'worker.restarted',
            worker: replacement.id,
          })
          return
        } catch {
          // Try again after the next delay.
        }
      }
    })
  }
}

function migrationSteps(migration: MigrationPlan): PlanStep[] {
  return [
    ...migration.created.map((table): PlanStep => ({
      path: `migration[${table}]`,
      impact: 'migration',
      reason: `Better Auth will create the ${table} table`,
    })),
    ...migration.added.map(({ table, fields }): PlanStep => ({
      path: `migration[${table}]`,
      impact: 'migration',
      reason: `Better Auth will add ${fields.join(', ')} to ${table}`,
    })),
    ...migration.unsafe.map((change): PlanStep => ({
      path: 'migration[unsafe]',
      impact: 'manual',
      reason: `Better Auth will not do this on its own: ${change}`,
    })),
  ]
}
