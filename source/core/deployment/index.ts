export {
  ApplyInProgressError,
  type ApplyRequest,
  type ApplyResult,
  BlockedPlanError,
  ConfirmationRequiredError,
  Deployment,
  type DeploymentOptions,
  type DeploymentPorts,
  type PlannedApply,
  StalePlanError,
  UnhealthyWorkerError,
  UnknownRevisionError,
} from './deployment.ts'
export {
  checkOnce,
  type HealthOptions,
  type Probe,
  trustedOrigins,
  waitHealthy,
} from './health.ts'
export type {
  ActiveState,
  ApplyLock,
  Artifacts,
  DeploymentEvent,
  EventSink,
  Lease,
  MigrationPlan,
  Migrator,
  RevisionStore,
  SecretResolver,
  Traffic,
  Worker,
  Workers,
} from './ports.ts'
export { StaleBaseError } from './ports.ts'
export * from './fakes.ts'
