import { UnresolvedSecretsError } from '@khatm/auth'
import {
  type ErrorBody,
  type ErrorCode,
  type PlanView,
  type Procedure,
  procedures,
  type RevisionView,
  STATUS,
} from '@khatm/contract'
import {
  ApplyInProgressError,
  BlockedPlanError,
  ConfirmationRequiredError,
  type DeploymentEvent,
  type EventSink,
  type PlannedApply,
  StalePlanError,
  UnhealthyWorkerError,
  UnknownRevisionError,
} from '@khatm/deployment'
import { defaultRegistry, UnresolvableManifestError } from '@khatm/registry'
import { InvalidManifestError, parseManifest, type Revision } from '@khatm/spec'
import type { Runtime } from './runtime.ts'

/** Who is calling, as the transport could tell: never something the body claims. */
export interface Caller {
  readonly author: string
}

/** The last events, kept in memory for `khatm.events`. */
export class EventLog implements EventSink {
  private readonly entries: {
    at: string
    type: string
    data: Record<string, unknown>
  }[] = []

  constructor(private readonly capacity = 500) {}

  emit(event: DeploymentEvent): void {
    const { type, ...data } = event
    this.entries.push({ at: new Date().toISOString(), type, data })
    if (this.entries.length > this.capacity) this.entries.shift()
  }

  latest(limit: number) {
    return this.entries.slice(-limit)
  }
}

export class ControlError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: Partial<ErrorBody['error']> = {},
  ) {
    super(message)
  }
}

/** The control API's behavior, independent of how it is served. */
export class ControlService {
  constructor(
    private readonly runtime: Pick<Runtime, 'deployment' | 'store' | 'proxy'>,
    private readonly log: EventLog,
  ) {}

  /** Validates the body, runs the procedure and answers with a JSON-ready body and status. */
  async handle(
    name: string,
    body: unknown,
    caller: Caller | undefined,
  ): Promise<{ status: number; body: unknown }> {
    try {
      if (!caller) throw new ControlError('unauthenticated', 'Unknown caller')
      const procedure = Object.values(procedures).find((p) => p.name === name)
      if (!procedure) {
        throw new ControlError('unknown_procedure', `No procedure ${name}`)
      }
      const input = procedure.input.safeParse(body)
      if (!input.success) {
        throw new ControlError('invalid_request', 'Invalid request', {
          details: input.error.issues.map((issue) =>
            `${issue.path.join('.') || '(body)'}: ${issue.message}`
          ),
        })
      }
      const output = await this.run(procedure, input.data, caller)
      return { status: 200, body: output }
    } catch (error) {
      return failure(error)
    }
  }

  private run(
    procedure: Procedure,
    input: unknown,
    caller: Caller,
  ): Promise<unknown> {
    const i = input as Record<string, unknown>
    switch (procedure.name) {
      case 'khatm.plan':
        return this.plan(i.manifest as Record<string, unknown>)
      case 'khatm.apply':
        return this.apply(i as never, caller)
      case 'khatm.rollback':
        return this.rollback(i as never, caller)
      case 'khatm.status':
        return this.status()
      case 'khatm.history':
        return this.history(i.limit as number)
      case 'khatm.events':
        return Promise.resolve({ events: this.log.latest(i.limit as number) })
    }
    throw new ControlError(
      'unknown_procedure',
      `No procedure ${procedure.name}`,
    )
  }

  private async plan(manifest: Record<string, unknown>) {
    return planView(await this.planned(manifest))
  }

  private async apply(
    input: {
      manifest: Record<string, unknown>
      base?: string
      confirmed: boolean
      reason?: string
    },
    caller: Caller,
  ) {
    const planned = await this.planned(input.manifest)
    return await this.applyPlanned(planned, input, caller)
  }

  private async rollback(
    input: {
      revision: string
      base?: string
      confirmed: boolean
      reason?: string
    },
    caller: Caller,
  ) {
    const planned = await this.runtime.deployment.planRollback(input.revision)
    return await this.applyPlanned(planned, {
      ...input,
      reason: input.reason ?? `rollback to ${input.revision}`,
    }, caller)
  }

  private async applyPlanned(
    planned: PlannedApply,
    input: { base?: string; confirmed: boolean; reason?: string },
    caller: Caller,
  ) {
    if (input.base !== undefined && input.base !== planned.base) {
      throw new StalePlanError()
    }
    const result = await this.runtime.deployment.apply(planned, {
      author: caller.author,
      reason: input.reason,
      confirmed: input.confirmed,
    })
    return {
      revision: revisionView(result.revision),
      changed: result.changed,
      plan: planView(planned),
    }
  }

  private status() {
    const active = this.runtime.deployment.activeRevision
    return Promise.resolve({
      active: active && revisionView(active),
      upstream: this.runtime.proxy.upstream,
    })
  }

  private async history(limit: number) {
    return {
      revisions: (await this.runtime.store.history(limit)).map(revisionView),
    }
  }

  private planned(manifest: Record<string, unknown>) {
    const resolved = defaultRegistry().resolve(parseManifest(manifest))
    return this.runtime.deployment.plan(resolved)
  }
}

function planView(planned: PlannedApply): PlanView {
  const { plan } = planned
  return {
    base: planned.base,
    desired: plan.desired,
    impact: plan.impact,
    isEmpty: plan.isEmpty,
    needsConfirmation: plan.needsConfirmation,
    isBlocked: plan.isBlocked,
    steps: plan.steps.map(({ path, impact, reason, derivedFrom }) => ({
      path,
      impact,
      reason,
      ...(derivedFrom === undefined ? {} : { derivedFrom }),
    })),
  }
}

function revisionView(revision: Revision): RevisionView {
  return {
    id: revision.id,
    ...(revision.parent === undefined ? {} : { parent: revision.parent }),
    manifest: revision.manifest,
    author: revision.author,
    ...(revision.reason === undefined ? {} : { reason: revision.reason }),
    createdAt: revision.createdAt.toISOString(),
  }
}

function failure(error: unknown): { status: number; body: ErrorBody } {
  const [code, message, extra] = classify(error)
  return {
    status: STATUS[code],
    body: { error: { code, message, ...extra } },
  }
}

function classify(
  error: unknown,
): [ErrorCode, string, Partial<ErrorBody['error']>] {
  const steps = (
    list: readonly { path: string; impact: string; reason: string }[],
  ) =>
    list.map(({ path, impact, reason }) => ({
      path,
      impact: impact as PlanView['impact'],
      reason,
    }))
  if (error instanceof ControlError) {
    return [error.code, error.message, error.extra]
  }
  if (error instanceof InvalidManifestError) {
    return ['invalid_manifest', error.message, { details: error.problems }]
  }
  if (error instanceof UnresolvableManifestError) {
    return ['invalid_manifest', error.message, { details: error.problems }]
  }
  if (error instanceof UnresolvedSecretsError) {
    return ['unresolved_secrets', error.message, { details: error.refs }]
  }
  if (error instanceof BlockedPlanError) {
    return ['blocked', error.message, { steps: steps(error.steps) }]
  }
  if (error instanceof ConfirmationRequiredError) {
    return ['confirmation_required', error.message, {
      steps: steps(error.steps),
    }]
  }
  if (error instanceof ApplyInProgressError) {
    return ['apply_in_progress', error.message, {}]
  }
  if (error instanceof StalePlanError) return ['stale_plan', error.message, {}]
  if (error instanceof UnhealthyWorkerError) {
    return ['unhealthy', error.message, { details: error.failures }]
  }
  if (error instanceof UnknownRevisionError) {
    return ['unknown_revision', `No revision ${error.message}`, {}]
  }
  console.error(error)
  return [
    'internal',
    error instanceof Error ? error.message : String(error),
    {},
  ]
}

/** Serves the control API on a Unix socket (`socket`) or a TCP port (`port`, behind an idhn guard). */
export function serveControl(
  service: ControlService,
  where: { socket: string } | { port: number; hostname?: string },
): Deno.HttpServer {
  const onSocket = 'socket' in where
  if (onSocket) {
    try {
      Deno.removeSync(where.socket)
    } catch {
      // Nothing left over.
    }
  }
  const handler = async (request: Request): Promise<Response> => {
    const name = new URL(request.url).pathname.replace(/^\//, '')
    let caller: Caller | undefined
    if (onSocket) {
      // Reaching the socket takes shell access to the container: that is the credential.
      caller = { author: 'socket' }
    } else {
      // The idhn guard has authenticated the caller; anything else is not from it.
      const subject = request.headers.get('x-idhn-subject')
      if (subject) caller = { author: subject }
    }
    if (request.method !== 'POST') {
      return json(405, {
        error: { code: 'invalid_request', message: 'POST only' },
      })
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json(400, {
        error: { code: 'invalid_request', message: 'Body is not JSON' },
      })
    }
    const result = await service.handle(name, body, caller)
    return json(result.status, result.body)
  }
  return onSocket
    ? Deno.serve({ path: where.socket, onListen: () => {} }, handler)
    : Deno.serve(
      {
        port: where.port,
        hostname: where.hostname ?? '0.0.0.0',
        onListen: () => {},
      },
      handler,
    )
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
