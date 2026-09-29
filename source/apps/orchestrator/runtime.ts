import type { SecretSource } from '@khatm/auth'
import {
  Deployment,
  type DeploymentEvent,
  type DeploymentOptions,
  type Workers,
} from '@khatm/deployment'
import { SwitchableProxy } from '@khatm-libs/supervisor'
import {
  BetterAuthMigrator,
  FileArtifacts,
  KeyedSecretResolver,
  ProcessWorkers,
  ProxyTraffic,
} from './adapters.ts'
import { EventLog } from './control.ts'
import { Bundles } from './bundles.ts'
import { openSql, type SqlClient } from './sql.ts'
import {
  installationKey,
  migrateStore,
  SqlApplyLock,
  SqlRevisionStore,
} from './stores.ts'

export interface RuntimeConfig {
  /** The orchestrator's own database: `postgres://…` or a SQLite path. */
  store: string
  /** Where revision artifacts are written. */
  artifactsDirectory: string
  /** The worker app's entry point. */
  workerEntry: string
  /** Environment for workers, on top of this process's own. */
  workerEnv?: Record<string, string>
  secrets?: SecretSource
  onEvent?: (event: DeploymentEvent) => void
  deployment?: DeploymentOptions
  /** Wraps the process workers, for tests that need one to misbehave. */
  wrapWorkers?: (workers: Workers) => Workers
}

export interface Runtime {
  readonly deployment: Deployment
  readonly store: SqlRevisionStore
  readonly proxy: SwitchableProxy
  readonly client: SqlClient
  readonly events: EventLog
  readonly bundles: Bundles
  close(): Promise<void>
}

/** Wires the deployment to real processes, a real proxy and a SQL store. */
export async function createRuntime(config: RuntimeConfig): Promise<Runtime> {
  const client = openSql(config.store)
  await migrateStore(client)
  const proxy = new SwitchableProxy()
  const events = new EventLog()
  const store = new SqlRevisionStore(client)
  const bundles = new Bundles(store)
  const workers = new ProcessWorkers(config.workerEntry, config.workerEnv)
  const deployment = new Deployment({
    store,
    lock: new SqlApplyLock(client),
    workers: config.wrapWorkers?.(workers) ?? workers,
    traffic: new ProxyTraffic(proxy),
    migrator: new BetterAuthMigrator(config.secrets),
    secrets: new KeyedSecretResolver(
      await installationKey(client),
      config.secrets,
    ),
    artifacts: new FileArtifacts(config.artifactsDirectory, bundles),
    events: {
      emit: (event) => {
        events.emit(event)
        config.onEvent?.(event)
      },
    },
  }, config.deployment)
  return {
    deployment,
    store,
    proxy,
    client,
    events,
    bundles,
    async close() {
      await deployment.shutdown()
      await client.close()
    },
  }
}
