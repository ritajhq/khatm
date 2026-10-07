import { ErrorBody } from '@khatm/contract'
import type { Deployment } from '@khatm/deployment'
import { BootstrapSpec, type Placement } from '@khatm/spec'
import { ControlError } from './errors.ts'
import type { SqlClient } from './sql.ts'
import { claimOnce, isDone, type SqlAuditLog } from './stores.ts'

/**
 * Hands data-plane procedures to the serving worker's internal admin
 * surface. The worker runs them through Better Auth; its refusals come back
 * as the same contract errors.
 */
export class WorkerAdmin {
  constructor(private readonly deployment: Pick<Deployment, 'admin'>) {}

  async call(name: string, input: unknown): Promise<unknown> {
    const admin = this.deployment.admin
    if (!admin) {
      throw new ControlError(
        'no_active_revision',
        'No worker is serving yet, so there are no users to administer',
      )
    }
    const response = await fetch(`${admin.url}/${name}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${admin.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    const body = await response.json()
    if (response.ok) return body
    const error = ErrorBody.safeParse(body)
    if (!error.success) {
      throw new ControlError('internal', `Worker answered ${response.status}`)
    }
    throw new ControlError(error.data.error.code, error.data.error.message)
  }
}

/** Who khatm's own actions are recorded as. */
export const KHATM_ACTOR = 'khatm'

/**
 * Applies a manifest's `bootstrap` block the first time a live revision has
 * one: creates the users it names that don't exist yet and gives them their
 * roles. After that it never runs again, and later edits to the block are
 * ignored. Each step is idempotent, so a failed run is simply retried on the
 * next activation or start. A user whose email comes from a variable this
 * deployment doesn't set is not created here.
 */
export class Bootstrap {
  private running: Promise<void> | undefined

  constructor(
    private readonly client: SqlClient,
    private readonly deployment: Pick<Deployment, 'activeState'>,
    private readonly admin: WorkerAdmin,
    private readonly audit: SqlAuditLog,
    private readonly placement: Placement,
  ) {}

  /** Runs at most one pass at a time. */
  run(): Promise<void> {
    this.running ??= this.pass().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async pass(): Promise<void> {
    if (await isDone(this.client, 'bootstrap')) return
    const state = this.deployment.activeState
    const authored = state?.authored as { bootstrap?: unknown } | undefined
    if (!state || authored?.bootstrap === undefined) return
    const spec = this.placement.bootstrap(
      BootstrapSpec.parse(authored.bootstrap),
    )
    const revision = state.revision.id

    for (const user of spec.users) {
      const existing = await this.admin.call('users.get', { user: user.email })
        .then((detail) =>
          (detail as { user: { id: string; role?: string } }).user
        )
        .catch((error) => {
          if (error instanceof ControlError && error.code === 'unknown_user') {
            return undefined
          }
          throw error
        })
      if (!existing) {
        const created = await this.admin.call('users.create', {
          email: user.email,
          name: user.name,
          ...(user.role === undefined ? {} : { role: user.role }),
        }) as { user: { id: string } }
        await this.audit.record({
          actor: KHATM_ACTOR,
          action: 'users.create',
          target: created.user.id,
          revision,
          outcome: 'ok',
          details: { bootstrap: true, email: user.email, role: user.role },
        })
      } else if (user.role !== undefined && existing.role !== user.role) {
        await this.admin.call('users.setRole', {
          user: existing.id,
          role: user.role,
        })
        await this.audit.record({
          actor: KHATM_ACTOR,
          action: 'users.setRole',
          target: existing.id,
          revision,
          outcome: 'ok',
          details: { bootstrap: true, role: user.role },
        })
      }
    }
    await claimOnce(this.client, 'bootstrap')
  }
}
