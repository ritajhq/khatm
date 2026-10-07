import {
  fingerprintSecrets,
  planMigrations,
  processSecrets,
  runMigrations,
  type SecretSource,
} from '@khatm/auth'
import {
  type ActiveState,
  type Artifacts,
  type MigrationPlan,
  type Migrator,
  type SecretResolver,
  type Traffic,
  trustedOrigins,
  type Worker,
  type Workers,
} from '@khatm/deployment'
import type { Bundles } from './bundles.ts'
import { defaultRegistry } from '@khatm/registry'
import {
  type PlacedManifest,
  Placement,
  type ResolvedManifest,
  type SecretFingerprints,
} from '@khatm/spec'
import {
  freePort,
  ManagedProcess,
  type SwitchableProxy,
} from '@khatm-libs/supervisor'

/**
 * Migrates the database the manifest names in this deployment. Planning
 * places the manifest first, so one that doesn't fit the deployment fails
 * the plan, like a secret that doesn't resolve.
 */
export class BetterAuthMigrator implements Migrator {
  private readonly placement: Placement

  constructor(private readonly source: SecretSource = processSecrets) {
    this.placement = new Placement((name) => source.env(name))
  }

  plan(resolved: ResolvedManifest): Promise<MigrationPlan> {
    return planMigrations(this.place(resolved), this.source)
  }

  run(resolved: ResolvedManifest): Promise<void> {
    return runMigrations(this.place(resolved), this.source)
  }

  private place(resolved: ResolvedManifest): PlacedManifest {
    return defaultRegistry().place(resolved, this.placement)
  }
}

/** Resolves every secret the manifest references and fingerprints it under the installation key. */
export class KeyedSecretResolver implements SecretResolver {
  constructor(
    private readonly key: string,
    private readonly source: SecretSource = processSecrets,
  ) {}

  fingerprints(resolved: ResolvedManifest): Promise<SecretFingerprints> {
    return fingerprintSecrets(resolved.auth, this.source, this.key)
  }
}

export class ProxyTraffic implements Traffic {
  constructor(private readonly proxy: SwitchableProxy) {}

  switchTo(upstream: string): void {
    this.proxy.switchTo(upstream)
  }

  drain(upstream: string, timeoutMs: number): Promise<void> {
    return this.proxy.drain(upstream, timeoutMs)
  }
}

/** Runs each worker as a child `deno run` of the worker app, on its own ports. */
export class ProcessWorkers implements Workers {
  private count = 0
  /** Lets the orchestrator, and nothing else on the host, call the workers' admin surface. */
  private readonly adminToken = crypto.randomUUID() + crypto.randomUUID()

  constructor(
    private readonly workerEntry: string,
    private readonly env: Record<string, string> = {},
    private readonly stopGraceMs = 5_000,
  ) {}

  start(resolved: ResolvedManifest): Promise<Worker> {
    // Placed as the worker will place it, in the same environment, so a
    // manifest that doesn't fit fails here and the health check asks the
    // origins the worker really trusts.
    const placed = defaultRegistry().place(
      resolved,
      new Placement((name) => this.env[name] ?? Deno.env.get(name)),
    )
    const port = freePort()
    const adminPort = freePort()
    const id = `worker-${++this.count}`
    const process = ManagedProcess.start({
      command: Deno.execPath(),
      args: ['run', '-A', '--no-prompt', this.workerEntry],
      env: {
        ...this.env,
        PORT: String(port),
        ADMIN_PORT: String(adminPort),
        KHATM_ADMIN_TOKEN: this.adminToken,
      },
      stdin: JSON.stringify(resolved),
      label: id,
    })
    const stopGraceMs = this.stopGraceMs
    return Promise.resolve({
      id,
      upstream: `http://127.0.0.1:${port}`,
      admin: { url: `http://127.0.0.1:${adminPort}`, token: this.adminToken },
      trustedOrigins: trustedOrigins(placed),
      get alive() {
        return process.alive
      },
      get output() {
        return process.output
      },
      exited: process.exited.then(() => {}),
      async stop(graceMs = stopGraceMs) {
        await process.stop(graceMs)
      },
    })
  }
}

/**
 * Writes each revision's bundle to `<directory>/<revision-id>/`, into a
 * temporary directory first and then renamed, so a bundle is never half
 * there. `current` is a symlink to the live revision.
 */
export class FileArtifacts implements Artifacts {
  constructor(
    private readonly directory: string,
    private readonly bundles: Bundles,
  ) {}

  async write(state: ActiveState): Promise<void> {
    const bundle = await this.bundles.build(state)
    const target = `${this.directory}/${state.revision.id}`
    const temp = `${this.directory}/.tmp-${state.revision.id}`
    await Deno.remove(temp, { recursive: true }).catch(() => {})
    for (const [path, content] of Object.entries(bundle)) {
      await Deno.mkdir(dirname(`${temp}/${path}`), { recursive: true })
      await Deno.writeTextFile(`${temp}/${path}`, content)
    }
    await Deno.remove(target, { recursive: true }).catch(() => {})
    await Deno.rename(temp, target)
  }

  async activated(state: ActiveState): Promise<void> {
    const link = `${this.directory}/current`
    const temp = `${this.directory}/.current-${state.revision.id}`
    await Deno.remove(temp).catch(() => {})
    await Deno.symlink(state.revision.id, temp)
    await Deno.rename(temp, link)
  }
}

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}
