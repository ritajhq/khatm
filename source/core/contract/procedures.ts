import { z } from 'zod'
import { AuditEntryView, UserDetail, UserRef, UserView } from './identity.ts'

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

export const FindingView = z.object({
  check: z.string(),
  severity: z.enum(['ok', 'info', 'warn', 'fail']),
  message: z.string(),
})
export type FindingView = z.infer<typeof FindingView>

/**
 * Checks an installation: the manifest's consistency, secrets and database
 * as the orchestrator sees them, the serving worker, and consumers' guard
 * manifests against the session contract.
 */
export const doctor = procedure(
  'khatm.doctor',
  z.object({
    /** Defaults to the active revision's manifest. */
    manifest: ManifestInput.optional(),
    /** Consumers' idhn guard manifests, parsed from YAML. */
    guards: z.array(z.object({
      name: z.string().min(1),
      manifest: z.record(z.string(), z.unknown()),
    })).max(50).default([]),
  }),
  z.object({ findings: z.array(FindingView) }),
)

const Paging = {
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
}

export const listUsers = procedure(
  'users.list',
  z.object({
    /** Matches users whose `field` contains it. */
    search: z.string().min(1).optional(),
    field: z.enum(['email', 'name']).default('email'),
    ...Paging,
  }),
  z.object({ users: z.array(UserView), total: z.number() }),
)

/** The read-only directory other services use, instead of querying Better Auth's tables. */
export const lookupUsers = procedure(
  'users.lookup',
  z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }),
  z.object({ users: z.array(UserView) }),
)

export const getUser = procedure(
  'users.get',
  z.object({ user: UserRef }),
  UserDetail,
)

export const createUser = procedure(
  'users.create',
  z.object({
    email: z.email(),
    name: z.string().min(1),
    /** Left out, the user has no password until one is set or they use a provider. */
    password: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
  }),
  z.object({ user: UserView }),
)

export const banUser = procedure(
  'users.ban',
  z.object({
    user: UserRef,
    reason: z.string().min(1).optional(),
    /** Left out, the ban lasts until `users.unban`. */
    expiresInSeconds: z.number().int().positive().optional(),
  }),
  z.object({ user: UserView }),
)

export const unbanUser = procedure(
  'users.unban',
  z.object({ user: UserRef }),
  z.object({ user: UserView }),
)

export const setRole = procedure(
  'users.setRole',
  z.object({ user: UserRef, role: z.string().min(1) }),
  z.object({ user: UserView }),
)

export const verifyEmail = procedure(
  'users.verifyEmail',
  z.object({ user: UserRef }),
  z.object({ user: UserView }),
)

export const setPassword = procedure(
  'users.setPassword',
  z.object({ user: UserRef, password: z.string().min(1) }),
  z.object({ user: UserView }),
)

export const removeUser = procedure(
  'users.remove',
  z.object({
    user: UserRef,
    /** Removal can't be undone, so it must be asked for explicitly. */
    confirmed: z.boolean().default(false),
  }),
  z.object({ removed: z.string() }),
)

export const revokeSessions = procedure(
  'sessions.revoke',
  z.object({
    user: UserRef,
    /** One session's id; left out, every session of the user. */
    session: z.string().min(1).optional(),
  }),
  z.object({ revoked: z.number() }),
)

export const audit = procedure(
  'audit.list',
  z.object({
    limit: z.number().int().min(1).max(500).default(100),
    /** Entries older than this id, for paging back. */
    before: z.number().int().positive().optional(),
    actor: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
  }),
  z.object({ entries: z.array(AuditEntryView) }),
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
  doctor,
  listUsers,
  lookupUsers,
  getUser,
  createUser,
  banUser,
  unbanUser,
  setRole,
  verifyEmail,
  setPassword,
  removeUser,
  revokeSessions,
  audit,
}
export type Procedures = typeof procedures

/**
 * The data-plane procedures. The orchestrator hands them to the serving
 * worker's internal admin surface, which runs them through Better Auth.
 */
export const identityProcedures: readonly Procedure[] = [
  listUsers,
  lookupUsers,
  getUser,
  createUser,
  banUser,
  unbanUser,
  setRole,
  verifyEmail,
  setPassword,
  removeUser,
  revokeSessions,
]
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
  'unknown_user',
  /** khatm's own service user, which no one may change. */
  'protected_user',
  /** Better Auth refused the change, such as a too short password. */
  'rejected',
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
  unknown_user: 404,
  protected_user: 403,
  rejected: 422,
  blocked: 409,
  confirmation_required: 409,
  apply_in_progress: 409,
  stale_plan: 409,
  unhealthy: 422,
  internal: 500,
}
