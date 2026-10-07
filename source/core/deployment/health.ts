import type { ResolvedManifest } from '@khatm/spec'
import type { Worker } from './ports.ts'

export type Probe = (url: string, init?: RequestInit) => Promise<Response>

export interface HealthOptions {
  probe?: Probe
  /** How long a worker gets to become healthy. */
  timeoutMs?: number
  intervalMs?: number
}

/** The origins the worker must answer CORS preflights for. */
export function trustedOrigins(resolved: ResolvedManifest): string[] {
  const value = resolved.derived['trustedOrigins']?.value
  return Array.isArray(value) ? value.map(String) : []
}

/** One pass over the four checks; returns what failed, empty when healthy. */
export async function checkOnce(
  worker: Worker,
  resolved: ResolvedManifest,
  probe: Probe = fetch,
): Promise<string[]> {
  if (!worker.alive) return ['process is not running']
  const failures: string[] = []
  const attempt = async (name: string, check: () => Promise<string | void>) => {
    try {
      const failure = await check()
      if (failure) failures.push(`${name}: ${failure}`)
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  await attempt('ok endpoint', async () => {
    const response = await probe(`${worker.upstream}/api/auth/ok`)
    await response.body?.cancel()
    if (response.status !== 200) return `status ${response.status}`
  })

  // Without a cookie Better Auth answers `null`, and on an unmigrated
  // database it throws, so this also proves the schema is in place.
  await attempt('session lookup', async () => {
    const response = await probe(`${worker.upstream}/api/auth/get-session`)
    const body = (await response.text()).trim()
    if (response.status !== 200 || body !== 'null') {
      return `status ${response.status}, body ${body.slice(0, 80)}`
    }
  })

  for (const origin of worker.trustedOrigins ?? trustedOrigins(resolved)) {
    await attempt(`preflight ${origin}`, async () => {
      const response = await probe(`${worker.upstream}/api/auth/get-session`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
        },
      })
      await response.body?.cancel()
      const allowed = response.headers.get('access-control-allow-origin')
      const credentials = response.headers.get(
        'access-control-allow-credentials',
      )
      if (allowed !== origin || credentials !== 'true') {
        return `answered origin ${allowed ?? 'none'}, credentials ${
          credentials ?? 'none'
        }`
      }
    })
  }
  return failures
}

/** Polls until healthy, the worker dies, or the timeout passes. */
export async function waitHealthy(
  worker: Worker,
  resolved: ResolvedManifest,
  options: HealthOptions = {},
): Promise<string[]> {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000)
  let failures: string[] = []
  while (true) {
    failures = await checkOnce(worker, resolved, options.probe)
    if (failures.length === 0) return []
    if (!worker.alive || Date.now() >= deadline) {
      return worker.output.length > 0
        ? [...failures, `output: ${worker.output.slice(-500)}`]
        : failures
    }
    await new Promise((resolve) =>
      setTimeout(resolve, options.intervalMs ?? 200)
    )
  }
}
