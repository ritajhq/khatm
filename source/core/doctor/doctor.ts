import { sessionCookieName } from '@khatm/contract/guard'
import { isWithinDomain, type PlacedManifest, type Reading } from '@khatm/spec'

/**
 * `ok` passed, `info` is something to know or do (like a redirect URI to
 * register), `warn` may bite, `fail` will.
 */
export type Severity = 'ok' | 'info' | 'warn' | 'fail'

export interface Finding {
  /** A short, stable name for what was checked, like `database`. */
  readonly check: string
  readonly severity: Severity
  readonly message: string
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/

/** Whether a failure anywhere should stop a script. */
export function failed(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'fail')
}

/**
 * What this deployment's environment supplies for the manifest: each value
 * read, and each reference nothing is set for. One that isn't set stops a
 * worker from starting, so it fails.
 */
export function placementFindings(readings: readonly Reading[]): Finding[] {
  return readings.map((reading) =>
    reading.value === undefined
      ? {
        check: 'placement',
        severity: 'fail',
        message: `${reading.path}: ${reading.env} is not set`,
      }
      : {
        check: 'placement',
        severity: 'ok',
        message: `${reading.path} = ${reading.value} (from ${reading.env})`,
      }
  )
}

/**
 * What can be told from the manifest alone: base URL consistency, whether
 * the session cookie reaches the service's apps, and the OAuth redirect URIs
 * to register with each provider.
 */
export function configFindings(resolved: PlacedManifest): Finding[] {
  const { auth, branding } = resolved
  const findings: Finding[] = []
  const base = new URL(auth.baseURL)

  if (base.protocol === 'http:' && !LOCAL.test(base.hostname)) {
    findings.push({
      check: 'base-url',
      severity: 'warn',
      message:
        `${auth.baseURL} is plain http on a public host: session cookies travel unencrypted`,
    })
  } else {
    findings.push({
      check: 'base-url',
      severity: 'ok',
      message: `${auth.baseURL}`,
    })
  }
  if (!auth.session.introspectionURL.endsWith('/api/auth/get-session')) {
    findings.push({
      check: 'session-contract',
      severity: 'warn',
      message:
        `introspectionURL ${auth.session.introspectionURL} doesn't end in /api/auth/get-session, where Better Auth answers`,
    })
  }

  const firstParty = auth.applications.flatMap((app) =>
    app.kind === 'first-party' ? [app] : []
  )
  const domain = auth.session.cookieDomain
  if (domain !== undefined && !isWithinDomain(base.hostname, domain)) {
    findings.push({
      check: 'cookie-domain',
      severity: 'fail',
      message:
        `The auth server ${base.hostname} is outside the cookie domain ${domain}, so it can't set the session cookie there`,
    })
  }
  for (const app of firstParty) {
    const origin = new URL(app.origin)
    const reaches = domain === undefined
      ? origin.hostname === base.hostname
      : isWithinDomain(origin.hostname, domain)
    if (!reaches) {
      findings.push({
        check: 'cookie-domain',
        severity: 'warn',
        message: domain === undefined
          ? `${app.id} (${app.origin}) is on another host and no cookieDomain is set: a guard in front of it never sees the session cookie`
          : `${app.id} (${app.origin}) is outside the cookie domain ${domain}: a guard in front of it never sees the session cookie`,
      })
    }
    if (origin.protocol === 'https:' && base.protocol === 'http:') {
      findings.push({
        check: 'base-url',
        severity: 'warn',
        message:
          `${app.id} is served over https but auth over http: the browser may drop the cookie on cross-site requests`,
      })
    }
  }

  for (const provider of Object.keys(auth.socialProviders).sort()) {
    findings.push({
      check: 'oauth-redirect',
      severity: 'info',
      message: `Register ${new URL(
        `/api/auth/callback/${provider}`,
        auth.baseURL,
      )} as a redirect URI with ${provider}`,
    })
  }

  const signIn = (auth.emailAndPassword?.enabled ?? false) ||
    Object.keys(auth.socialProviders).length > 0
  if (!signIn) {
    findings.push({
      check: 'sign-in',
      severity: 'warn',
      message: 'No sign-in method is enabled: nobody can sign in',
    })
  }
  if (branding.pages === 'headless' && firstParty.length === 0) {
    findings.push({
      check: 'sign-in',
      severity: 'warn',
      message:
        'Pages are headless but no first-party app is declared to build them',
    })
  }
  return findings
}

/** A consumer's idhn guard manifest, as parsed YAML. */
export interface GuardManifest {
  readonly name: string
  readonly manifest: unknown
}

interface CookieScheme {
  scheme?: unknown
  session_url?: unknown
  cookie?: unknown
  issuer?: unknown
  claims?: unknown
}

/**
 * Checks consumers' guard manifests against the session contract: the
 * session URL, cookie name and issuer must match, and every claim a guard
 * forwards must be one khatm publishes. A mismatch is a guard that rejects
 * every request, or forwards a claim that is never there.
 */
export function guardFindings(
  resolved: PlacedManifest,
  guards: readonly GuardManifest[],
): Finding[] {
  const { session, baseURL } = resolved.auth
  const cookie = sessionCookieName(baseURL)
  const findings: Finding[] = []
  for (const guard of guards) {
    const check = `guard:${guard.name}`
    const authentication = (guard.manifest as { authentication?: unknown })
      ?.authentication
    const schemes = (Array.isArray(authentication)
      ? authentication
      : authentication === undefined
      ? []
      : [authentication]) as CookieScheme[]
    const cookies = schemes.filter((s) =>
      s?.scheme === 'session-cookie'
    )
    if (cookies.length === 0) {
      findings.push({
        check,
        severity: 'warn',
        message:
          'No session-cookie authentication: it never reads khatm sessions',
      })
      continue
    }
    const problems: string[] = []
    for (const scheme of cookies) {
      if (scheme.session_url !== session.introspectionURL) {
        problems.push(
          `session_url is ${
            JSON.stringify(scheme.session_url)
          }, not ${session.introspectionURL}`,
        )
      }
      if (scheme.cookie !== cookie) {
        problems.push(
          `cookie is ${JSON.stringify(scheme.cookie)}, not ${cookie}`,
        )
      }
      if (scheme.issuer !== session.issuer) {
        problems.push(
          `issuer is ${JSON.stringify(scheme.issuer)}, not ${session.issuer}`,
        )
      }
      const claims = Array.isArray(scheme.claims) ? scheme.claims : []
      const unknown = claims.filter((c) => !session.claims.includes(c))
      if (unknown.length > 0) {
        problems.push(
          `claims ${unknown.join(', ')} aren't in the session contract`,
        )
      }
    }
    findings.push(
      problems.length === 0
        ? { check, severity: 'ok', message: 'Matches the session contract' }
        : { check, severity: 'fail', message: problems.join('; ') },
    )
  }
  return findings
}

/** What only a running installation can answer; each probe throws when its check fails. */
export interface Probes {
  /** Secret references that don't resolve here. */
  missingSecrets(): string[]
  /** Connects to the auth database; returns what Better Auth would still create. */
  database(): Promise<{ pending: string[] }>
  /** Whether the orchestrator's own store is the auth database. */
  sharesStore(): boolean | undefined
  /** An HTTP status for the URL, fetched from where khatm runs. */
  status(url: string): Promise<number>
  /** The serving worker's address, when one is serving. */
  upstream: string | undefined
}

export async function runtimeFindings(
  resolved: PlacedManifest,
  probes: Probes,
): Promise<Finding[]> {
  const findings: Finding[] = []
  const missing = probes.missingSecrets()
  findings.push(
    missing.length === 0
      ? { check: 'secrets', severity: 'ok', message: 'Every secret resolves' }
      : {
        check: 'secrets',
        severity: 'fail',
        message: `Not set or empty here: ${missing.join(', ')}`,
      },
  )

  // The database URL is itself a secret: without it there is nothing to reach.
  if (missing.length === 0) {
    try {
      const { pending } = await probes.database()
      findings.push({
        check: 'database',
        severity: 'ok',
        message: pending.length === 0
          ? `Reachable, schema up to date (${resolved.auth.database.dialect})`
          : `Reachable (${resolved.auth.database.dialect}); the next apply migrates ${
            pending.join(', ')
          }`,
      })
    } catch (error) {
      findings.push({
        check: 'database',
        severity: 'fail',
        message: `Can't reach it: ${
          error instanceof Error ? error.message : error
        }`,
      })
    }
  }
  const shares = probes.sharesStore()
  if (shares !== undefined) {
    findings.push({
      check: 'store',
      severity: 'info',
      message: shares
        ? "khatm's own tables live in the auth database, in their own schema or prefix"
        : "khatm's own store is a separate database from the auth database",
    })
  }

  if (probes.upstream === undefined) {
    findings.push({
      check: 'worker',
      severity: 'info',
      message: 'No worker is serving yet',
    })
  } else {
    findings.push(
      await reach('worker', `${probes.upstream}/api/auth/ok`, probes, 'fail'),
    )
  }
  findings.push(
    await reach(
      'public-url',
      new URL('/api/auth/ok', resolved.auth.baseURL).href,
      probes,
      'warn',
      ' from where khatm runs; fine if only the outside world can resolve it',
    ),
  )
  return findings
}

async function reach(
  check: string,
  url: string,
  probes: Probes,
  severity: Severity,
  note = '',
): Promise<Finding> {
  try {
    const status = await probes.status(url)
    return status === 200
      ? { check, severity: 'ok', message: `${url} answers` }
      : { check, severity, message: `${url} answered ${status}${note}` }
  } catch (error) {
    return {
      check,
      severity,
      message: `${url} doesn't answer (${
        error instanceof Error ? error.message : error
      })${note}`,
    }
  }
}
