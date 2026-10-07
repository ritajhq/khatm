import {
  planMigrations,
  processSecrets,
  resolveAllSecrets,
  type SecretSource,
  tryResolveSecret,
  UnresolvedSecretsError,
} from '@khatm/auth'
import {
  configFindings,
  failed,
  type Finding,
  guardFindings,
  type GuardManifest,
  placementFindings,
  runtimeFindings,
} from '@khatm/doctor'
import { defaultRegistry } from '@khatm/registry'
import {
  type PlacedManifest,
  Placement,
  type ResolvedManifest,
  UnplaceableManifestError,
} from '@khatm/spec'
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
import { Bootstrap, WorkerAdmin } from './identity.ts'
import {
  installationKey,
  migrateStore,
  SqlApplyLock,
  SqlAuditLog,
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
  readonly audit: SqlAuditLog
  /** The serving worker's admin surface, for data-plane procedures. */
  readonly admin: WorkerAdmin
  /** Applies the manifest's bootstrap block, unless that already happened. */
  readonly bootstrap: Bootstrap
  /** Checks a manifest as this installation would run it. */
  doctor(
    resolved: ResolvedManifest,
    guards: readonly GuardManifest[],
  ): Promise<Finding[]>
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
  const audit = new SqlAuditLog(client)
  const deployment: Deployment = new Deployment({
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
        if (event.type === 'apply.activated') {
          // Only fires during an apply, long after `bootstrap` below exists.
          bootstrap.run().catch((error) => {
            const failed = {
              type: 'bootstrap.failed',
              error: error instanceof Error ? error.message : String(error),
            }
            events.emit(failed)
            console.error(JSON.stringify(failed))
          })
        }
      },
    },
  }, config.deployment)
  const admin = new WorkerAdmin(deployment)
  const source = config.secrets ?? processSecrets
  const bootstrap = new Bootstrap(
    client,
    deployment,
    admin,
    audit,
    new Placement((name) => source.env(name)),
  )
  return {
    deployment,
    store,
    proxy,
    client,
    events,
    bundles,
    audit,
    admin,
    bootstrap,
    async doctor(unplaced, guards) {
      const placement = new Placement((name) => source.env(name))
      const placing = placementFindings(
        placement.readings({
          auth: unplaced.auth,
          branding: unplaced.branding,
        }),
      )
      let resolved: PlacedManifest
      try {
        resolved = defaultRegistry().place(unplaced, placement)
      } catch (error) {
        if (!(error instanceof UnplaceableManifestError)) throw error
        // Nothing else can be checked as this deployment would run it.
        return failed(placing) ? placing : [
          ...placing,
          ...error.problems.map((message): Finding => ({
            check: 'placement',
            severity: 'fail',
            message,
          })),
        ]
      }
      const runtime = await runtimeFindings(resolved, {
        missingSecrets() {
          try {
            resolveAllSecrets(resolved.auth, source)
            return []
          } catch (error) {
            if (error instanceof UnresolvedSecretsError) return error.refs
            throw error
          }
        },
        async database() {
          const plan = await planMigrations(resolved, source)
          return {
            pending: [
              ...plan.created,
              ...plan.added.map((a) => `${a.table}.${a.fields.join('/')}`),
            ],
          }
        },
        sharesStore() {
          const url = tryResolveSecret(resolved.auth.database.url, source)
          return url === undefined
            ? undefined
            : url.replace(/^sqlite:(\/\/)?/, '') ===
              config.store.replace(/^sqlite:(\/\/)?/, '')
        },
        async status(url) {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(3_000),
          })
          await response.body?.cancel()
          return response.status
        },
        upstream: proxy.upstream,
      })
      return [
        ...placing,
        ...configFindings(resolved),
        ...runtime,
        ...guardFindings(resolved, guards),
      ]
    },
    async close() {
      await deployment.shutdown()
      await client.close()
    },
  }
}
