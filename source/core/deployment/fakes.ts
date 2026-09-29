import { secretRefKey, secretRefs } from '@khatm/spec'
import type { ResolvedManifest, SecretFingerprints } from '@khatm/spec'
import { trustedOrigins } from './health.ts'
import type { Probe } from './health.ts'
import {
  type ActiveState,
  type ApplyLock,
  type Artifacts,
  type DeploymentEvent,
  type EventSink,
  type Lease,
  type MigrationPlan,
  type Migrator,
  type RevisionStore,
  type SecretResolver,
  StaleBaseError,
  type Traffic,
  type Worker,
  type Workers,
} from './ports.ts'

/** In-memory ports, for tests of the apply flow and for the adapters' own tests. */
export class MemoryRevisionStore implements RevisionStore {
  readonly history: ActiveState[] = []
  private current: ActiveState | undefined

  active(): Promise<ActiveState | undefined> {
    return Promise.resolve(this.current)
  }

  find(revisionId: string): Promise<ActiveState | undefined> {
    return Promise.resolve(
      this.history.find((state) => state.revision.id === revisionId),
    )
  }

  /** Makes `activate` fail, to test the switch-back. */
  failNextActivate = false

  activate(state: ActiveState, expectedActive: string | undefined) {
    if (this.failNextActivate) {
      this.failNextActivate = false
      return Promise.reject(new Error('store unavailable'))
    }
    if (this.current?.revision.id !== expectedActive) {
      return Promise.reject(new StaleBaseError())
    }
    this.current = state
    this.history.push(state)
    return Promise.resolve()
  }
}

export class MemoryLock implements ApplyLock {
  private held = false

  acquire(_owner: string): Promise<Lease | undefined> {
    if (this.held) return Promise.resolve(undefined)
    this.held = true
    return Promise.resolve({
      release: () => {
        this.held = false
        return Promise.resolve()
      },
    })
  }
}

export class FakeWorker implements Worker {
  alive = true
  output = ''
  readonly stopped: Promise<void>
  private markExited!: () => void
  readonly exited: Promise<void>
  private stopCalls = 0

  constructor(
    readonly id: string,
    readonly upstream: string,
    readonly resolved: ResolvedManifest,
    /** Answers the health probes correctly when true. */
    public healthy: boolean,
  ) {
    this.exited = new Promise((resolve) => (this.markExited = resolve))
    this.stopped = this.exited
  }

  get stopCount(): number {
    return this.stopCalls
  }

  crash(): void {
    this.alive = false
    this.output = 'boom'
    this.markExited()
  }

  stop(): Promise<void> {
    this.stopCalls += 1
    this.alive = false
    this.markExited()
    return Promise.resolve()
  }
}

export class FakeWorkers implements Workers {
  readonly started: FakeWorker[] = []
  /** Whether the next started workers come up healthy; consumed front to back. */
  script: boolean[] = []

  start(resolved: ResolvedManifest): Promise<Worker> {
    const n = this.started.length + 1
    const worker = new FakeWorker(
      `worker-${n}`,
      `http://fake-${n}`,
      resolved,
      this.script.shift() ?? true,
    )
    this.started.push(worker)
    return Promise.resolve(worker)
  }

  get last(): FakeWorker {
    return this.started[this.started.length - 1]
  }
}

/** A probe answering as a healthy Better Auth worker does, or not, per worker. */
export function fakeProbe(workers: FakeWorkers): Probe {
  return (url, init) => {
    const worker = workers.started.find((w) => url.startsWith(w.upstream))
    if (!worker || !worker.alive || !worker.healthy) {
      return Promise.resolve(new Response('unhealthy', { status: 500 }))
    }
    const path = new URL(url).pathname
    if (init?.method === 'OPTIONS') {
      const origin = new Headers(init.headers).get('origin') ?? ''
      const allowed = trustedOrigins(worker.resolved).includes(origin)
      return Promise.resolve(
        new Response(null, {
          status: 204,
          headers: allowed
            ? {
              'access-control-allow-origin': origin,
              'access-control-allow-credentials': 'true',
            }
            : {},
        }),
      )
    }
    if (path === '/api/auth/get-session') {
      return Promise.resolve(new Response('null', { status: 200 }))
    }
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  }
}

export class RecordingTraffic implements Traffic {
  readonly switches: string[] = []
  readonly drained: string[] = []

  get current(): string | undefined {
    return this.switches[this.switches.length - 1]
  }

  switchTo(upstream: string): void {
    this.switches.push(upstream)
  }

  drain(upstream: string): Promise<void> {
    this.drained.push(upstream)
    return Promise.resolve()
  }
}

export class FakeMigrator implements Migrator {
  pending: MigrationPlan = { created: [], added: [], unsafe: [] }
  readonly runs: ResolvedManifest[] = []

  plan(_resolved: ResolvedManifest): Promise<MigrationPlan> {
    return Promise.resolve(this.pending)
  }

  run(resolved: ResolvedManifest): Promise<void> {
    this.runs.push(resolved)
    this.pending = { created: [], added: [], unsafe: [] }
    return Promise.resolve()
  }
}

/** Fingerprints are the values themselves; tests only compare them. */
export class FakeSecrets implements SecretResolver {
  constructor(public values: Record<string, string> = {}) {}

  fingerprints(resolved: ResolvedManifest): Promise<SecretFingerprints> {
    const result: Record<string, string> = {}
    for (const ref of secretRefs(resolved.auth)) {
      const key = secretRefKey(ref)
      const value = this.values[key]
      if (value === undefined) {
        return Promise.reject(new Error(`Secret not set: ${key}`))
      }
      result[key] = `fp(${value})`
    }
    return Promise.resolve(result)
  }
}

export class MemoryArtifacts implements Artifacts {
  readonly written: ActiveState[] = []

  write(state: ActiveState): Promise<void> {
    this.written.push(state)
    return Promise.resolve()
  }
}

export class RecordingEvents implements EventSink {
  readonly events: DeploymentEvent[] = []

  emit(event: DeploymentEvent): void {
    this.events.push(event)
  }

  get types(): string[] {
    return this.events.map((event) => event.type)
  }
}
