import * as MUX from '@ritaj/mux'

export interface SessionOptions {
  /** khatm's session endpoint, reachable from where this runs: `http://auth:4100/api/auth/get-session`. */
  readonly url: string
  /** Who vouches for the identity, as policies see it. Defaults to the endpoint's origin. */
  readonly issuer?: string
  /** The user fields kept as claims. */
  readonly claims?: readonly string[]
  /**
   * How long an answer is reused for the same cookie: the lag before a
   * revoked session stops being recognized. 0 asks every time.
   */
  readonly ttlMs?: number
  readonly timeoutMs?: number
}

/** The cookie khatm's sessions travel in; `__Secure-` prefixed when it is served over https. */
const COOKIES = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
]

const DEFAULT_CLAIMS = ['email', 'name', 'emailVerified', 'role']

interface Answer {
  readonly caller: MUX.Caller
  readonly until: number
}

/**
 * A khatm session, as an authentication mechanism: the session cookie a
 * browser holds after signing in, verified by asking khatm whose it is. No
 * session is invalid; khatm not answering is unavailable, and never cached.
 */
export class Session implements MUX.Mechanism<MUX.Credentials.Cookie> {
  private readonly answers = new Map<string, Answer>()
  private readonly issuer: string
  private readonly claims: readonly string[]
  private readonly ttlMs: number
  private readonly timeoutMs: number

  constructor(private readonly options: SessionOptions) {
    this.issuer = options.issuer ?? new URL(options.url).origin
    this.claims = options.claims ?? DEFAULT_CLAIMS
    this.ttlMs = options.ttlMs ?? 5_000
    this.timeoutMs = options.timeoutMs ?? 2_000
  }

  Extract(envelope: MUX.Envelope): MUX.Credentials.Cookie | undefined {
    for (const name of COOKIES) {
      const value = envelope.Cookie(name)
      if (value !== undefined) return new MUX.Credentials.Cookie(name, value)
    }
    return undefined
  }

  async Verify(credential: MUX.Credentials.Cookie): Promise<MUX.Caller> {
    const key = `${credential.Name}=${credential.Value}`
    const cached = this.answers.get(key)
    if (cached && cached.until > Date.now()) return cached.caller

    const caller = await this.Ask(key)
    if (this.ttlMs > 0) {
      this.answers.set(key, { caller, until: Date.now() + this.ttlMs })
    }
    return caller
  }

  /** Throws when khatm can't be asked or doesn't answer like itself: the caller is then unavailable. */
  private async Ask(cookie: string): Promise<MUX.Caller> {
    const response = await fetch(this.options.url, {
      headers: { cookie },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`The session endpoint answered ${response.status}`)
    }

    const body = await response.json() as {
      user?: Record<string, unknown> & { id?: unknown }
      session?: { expiresAt?: unknown }
    } | null
    if (body === null) return MUX.Caller.Invalid
    if (typeof body.user?.id !== 'string') {
      throw new Error('The session endpoint did not answer with a session')
    }

    const expires = typeof body.session?.expiresAt === 'string'
      ? new Date(body.session.expiresAt)
      : undefined
    return MUX.Caller.Authenticated(
      body.user.id,
      this.issuer,
      this.ClaimsOf(body.user),
      expires,
    )
  }

  private ClaimsOf(user: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      this.claims.filter((claim) => claim in user).map((
        claim,
      ) => [claim, user[claim]]),
    )
  }
}
