import {
  fingerprintSecrets,
  planMigrations,
  processSecrets,
  runMigrations,
  type SecretSource,
} from '@khatm/auth'
import type {
  ActiveState,
  Artifacts,
  MigrationPlan,
  Migrator,
  SecretResolver,
  Traffic,
  Worker,
  Workers,
} from '@khatm/deployment'
import type { ResolvedManifest, SecretFingerprints } from '@khatm/spec'
import {
  freePort,
  ManagedProcess,
  type SwitchableProxy,
} from '@khatm-libs/supervisor'

export class BetterAuthMigrator implements Migrator {
  constructor(private readonly source: SecretSource = processSecrets) {}

  plan(resolved: ResolvedManifest): Promise<MigrationPlan> {
    return planMigrations(resolved, this.source)
  }

  run(resolved: ResolvedManifest): Promise<void> {
    return runMigrations(resolved, this.source)
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

/** Runs each worker as a child `deno run` of the worker app, on its own port. */
export class ProcessWorkers implements Workers {
  private count = 0

  constructor(
    private readonly workerEntry: string,
    private readonly env: Record<string, string> = {},
    private readonly stopGraceMs = 5_000,
  ) {}

  start(resolved: ResolvedManifest): Promise<Worker> {
    const port = freePort()
    const id = `worker-${++this.count}`
    const process = ManagedProcess.start({
      command: Deno.execPath(),
      args: ['run', '-A', '--no-prompt', this.workerEntry],
      env: { ...this.env, PORT: String(port) },
      stdin: JSON.stringify(resolved),
      label: id,
    })
    const stopGraceMs = this.stopGraceMs
    return Promise.resolve({
      id,
      upstream: `http://127.0.0.1:${port}`,
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

/** Writes each activated revision's resolved manifest and revision record under a directory. */
export class FileArtifacts implements Artifacts {
  constructor(private readonly directory: string) {}

  async write(state: ActiveState): Promise<void> {
    const dir = `${this.directory}/revisions/${state.revision.id}`
    await Deno.mkdir(dir, { recursive: true })
    await Deno.writeTextFile(
      `${dir}/manifest.json`,
      JSON.stringify(state.resolved, null, 2) + '\n',
    )
    await Deno.writeTextFile(
      `${dir}/revision.json`,
      JSON.stringify(state.revision, null, 2) + '\n',
    )
  }
}
