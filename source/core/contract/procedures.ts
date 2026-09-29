import { z } from 'zod'

/**
 * The control API: every procedure is a POST of a JSON body to `/<name>`, so
 * an idhn guard manifest can carry one action per procedure and read facts
 * from the body. Both sides are checked against these schemas.
 */
export interface Procedure<
  Name extends string = string,
  In extends z.ZodType = z.ZodType,
  Out extends z.ZodType = z.ZodType,
> {
  readonly name: Name
  readonly input: In
  readonly output: Out
}

function procedure<
  Name extends string,
  In extends z.ZodType,
  Out extends z.ZodType,
>(
  name: Name,
  input: In,
  output: Out,
): Procedure<Name, In, Out> {
  return { name, input, output }
}

export const Impact = z.enum([
  'hot',
  'restart',
  'migration',
  'manual',
  'destructive',
])

export const PlanStepView = z.object({
  path: z.string(),
  impact: Impact,
  reason: z.string(),
  derivedFrom: z.string().optional(),
})

export const PlanView = z.object({
  /** The active revision this plan was computed against; send it back to `apply`. */
  base: z.string().optional(),
  desired: z.string(),
  impact: Impact,
  isEmpty: z.boolean(),
  needsConfirmation: z.boolean(),
  isBlocked: z.boolean(),
  steps: z.array(PlanStepView),
})
export type PlanView = z.infer<typeof PlanView>

export const RevisionView = z.object({
  id: z.string(),
  parent: z.string().optional(),
  manifest: z.string(),
  author: z.string(),
  reason: z.string().optional(),
  createdAt: z.string(),
})
export type RevisionView = z.infer<typeof RevisionView>

/** The authored manifest, as JSON; the server parses it with the domain schema. */
const ManifestInput = z.record(z.string(), z.unknown())

export const plan = procedure(
  'khatm.plan',
  z.object({ manifest: ManifestInput }),
  PlanView,
)

export const apply = procedure(
  'khatm.apply',
  z.object({
    manifest: ManifestInput,
    /** The `base` the plan returned: apply refuses when something else went live since. */
    base: z.string().optional(),
    confirmed: z.boolean().default(false),
    reason: z.string().optional(),
  }),
  z.object({ revision: RevisionView, changed: z.boolean(), plan: PlanView }),
)

export const rollback = procedure(
  'khatm.rollback',
  z.object({
    revision: z.string(),
    base: z.string().optional(),
    confirmed: z.boolean().default(false),
    reason: z.string().optional(),
  }),
  z.object({ revision: RevisionView, changed: z.boolean(), plan: PlanView }),
)

export const status = procedure(
  'khatm.status',
  z.object({}),
  z.object({
    active: RevisionView.optional(),
    /** The address the active worker listens on, for operators debugging a swap. */
    upstream: z.string().optional(),
  }),
)

export const history = procedure(
  'khatm.history',
  z.object({ limit: z.number().int().min(1).max(200).default(20) }),
  z.object({ revisions: z.array(RevisionView) }),
)

export const events = procedure(
  'khatm.events',
  z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  z.object({
    events: z.array(z.object({
      at: z.string(),
      type: z.string(),
      data: z.record(z.string(), z.unknown()),
    })),
  }),
)

export const exportBundle = procedure(
  'khatm.export',
  z.object({
    /** Defaults to the active revision. */
    revision: z.string().optional(),
  }),
  z.object({
    revision: RevisionView,
    /** Bundle path to file content. */
    files: z.record(z.string(), z.string()),
  }),
)

export const manifest = procedure(
  'khatm.manifest',
  z.object({
    /** Defaults to the active revision. */
    revision: z.string().optional(),
  }),
  z.object({
    revision: RevisionView,
    /** What the operator wrote; absent for revisions recorded before it was kept. */
    authored: z.record(z.string(), z.unknown()).optional(),
    /** What the worker was built from. Secret references only, never values. */
    resolved: z.record(z.string(), z.unknown()),
  }),
)

export const procedures = {
  plan,
  apply,
  rollback,
  status,
  history,
  events,
  export: exportBundle,
  manifest,
}
export type Procedures = typeof procedures
export type ProcedureName = Procedures[keyof Procedures]['name']

export type Input<P extends Procedure> = z.input<P['input']>
export type Output<P extends Procedure> = z.output<P['output']>

/** Why a call failed, in a form both sides can act on. */
export const ErrorCode = z.enum([
  'unauthenticated',
  'invalid_request',
  'invalid_manifest',
  'unresolved_secrets',
  'unknown_procedure',
  'unknown_revision',
  'no_active_revision',
  'blocked',
  'confirmation_required',
  'apply_in_progress',
  'stale_plan',
  'unhealthy',
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** The plan steps behind `blocked` and `confirmation_required`. */
    steps: z.array(PlanStepView).optional(),
    details: z.array(z.string()).optional(),
  }),
})
export type ErrorBody = z.infer<typeof ErrorBody>

/** HTTP status for each error code. */
export const STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  invalid_request: 400,
  invalid_manifest: 400,
  unresolved_secrets: 422,
  unknown_procedure: 404,
  unknown_revision: 404,
  no_active_revision: 404,
  blocked: 409,
  confirmation_required: 409,
  apply_in_progress: 409,
  stale_plan: 409,
  unhealthy: 422,
  internal: 500,
}
