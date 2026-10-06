import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose'

/**
 * A stand-in for a third-party site with a "Login with Ritaj" button. It
 * lives outside khatm's cookie domain, so it can't read khatm's session: it
 * signs users in as an OAuth client instead (authorization code, PKCE and
 * its client secret), then checks and shows what khatm handed it.
 */
class Partner {
  /** khatm's public signing keys, fetched on first use and cached. */
  private readonly keys: ReturnType<typeof createRemoteJWKSet>

  constructor(private readonly config: PartnerConfig) {
    this.keys = createRemoteJWKSet(new URL(config.jwksURL))
  }

  async visit(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/') return page(this.home())
    if (url.pathname === '/login') return await this.login()
    if (url.pathname === '/callback') return await this.callback(request, url)
    return new Response('Not found', { status: 404 })
  }

  private home(): string {
    return `<p>A third-party site. It can't see your khatm session; it asks khatm through OAuth.</p>
<a class="button" href="/login">Login with Ritaj</a>`
  }

  /**
   * Sends the user to khatm's authorize endpoint, remembering the PKCE
   * verifier, the state and the nonce in a short-lived cookie. The nonce
   * comes back inside the ID token, tying it to this attempt.
   */
  private async login(): Promise<Response> {
    const verifier = randomToken()
    const state = randomToken()
    const nonce = randomToken()
    const authorize = new URL(`${this.config.issuer}/oauth2/authorize`)
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
    }).toString()
    return new Response(null, {
      status: 303,
      headers: {
        location: authorize.href,
        'set-cookie':
          `oauth=${state}.${verifier}.${nonce}; Path=/callback; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
    })
  }

  /** Exchanges the code for tokens from the server, where the client secret lives, then asks who the user is. */
  private async callback(request: Request, url: URL): Promise<Response> {
    const error = url.searchParams.get('error')
    if (error) {
      return page(`<p class="status out">khatm said: ${escape(error)}</p>
<p>${escape(url.searchParams.get('error_description') ?? '')}</p>
<a class="button" href="/">Start over</a>`)
    }
    const [state, verifier, nonce] = (cookie(request, 'oauth') ?? '')
      .split('.')
    if (!state || state !== url.searchParams.get('state')) {
      return page(
        `<p class="status out">The state doesn't match: start over.</p>
<a class="button" href="/">Start over</a>`,
      )
    }

    const tokenResponse = await fetch(this.config.tokenURL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${
          btoa(`${this.config.clientId}:${this.config.clientSecret}`)
        }`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: url.searchParams.get('code') ?? '',
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
      }),
    })
    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok) {
      return page(`<p class="status out">The token exchange failed</p>
<pre>${escape(JSON.stringify(tokens, null, 2))}</pre>
<a class="button" href="/">Start over</a>`)
    }

    // Decoding a JWT proves nothing: anyone can write one. Check that khatm
    // signed it, for this app, recently, and in answer to this attempt.
    let claims: JWTPayload
    try {
      claims = (await jwtVerify(tokens.id_token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
      })).payload
      if (claims.nonce !== nonce) throw new Error('The nonce does not match')
    } catch (error) {
      return page(`<p class="status out">The ID token failed verification</p>
<p>${escape(error instanceof Error ? error.message : String(error))}</p>
<a class="button" href="/">Start over</a>`)
    }

    const userinfo = await (await fetch(this.config.userinfoURL, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })).json()
    return page(
      `<p class="status in">Signed in with Ritaj</p>
<p>The ID token's claims, verified against khatm's signing keys:</p>
<pre>${escape(JSON.stringify(claims, null, 2))}</pre>
<p>What the userinfo endpoint said:</p>
<pre>${escape(JSON.stringify(userinfo, null, 2))}</pre>
<a class="button" href="/">Start over</a>`,
      { 'set-cookie': 'oauth=; Path=/callback; Max-Age=0' },
    )
  }
}

interface PartnerConfig {
  /** khatm's public issuer, where browsers are sent: `<baseURL>/api/auth`. */
  readonly issuer: string
  /** The token endpoint as this server reaches it. */
  readonly tokenURL: string
  /** khatm's signing keys as this server reaches them. */
  readonly jwksURL: string
  /** The userinfo endpoint as this server reaches it. */
  readonly userinfoURL: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
}

function page(body: string, headers: Record<string, string> = {}): Response {
  return new Response(
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Partner demo</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 3rem auto; padding: 0 1rem; }
  .status { font-weight: 600; font-size: 1.25rem; }
  .in { color: #15803d; }
  .out { color: #b91c1c; }
  .button { display: inline-block; padding: .5rem 1rem; background: #4338ca; color: #fff; border-radius: .375rem; text-decoration: none; }
  pre { background: #f3f4f6; padding: 1rem; border-radius: .375rem; overflow-x: auto; }
</style>
</head>
<body>
<h1>Partner demo</h1>
${body}
</body>
</html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } },
  )
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

if (import.meta.main) {
  const env = (name: string): string => {
    const value = Deno.env.get(name)
    if (!value) {
      console.error(`${name} must be set`)
      Deno.exit(1)
    }
    return value
  }
  const partner = new Partner({
    issuer: env('ISSUER'),
    tokenURL: env('TOKEN_URL'),
    jwksURL: env('JWKS_URL'),
    userinfoURL: env('USERINFO_URL'),
    clientId: env('CLIENT_ID'),
    clientSecret: env('CLIENT_SECRET'),
    redirectUri: env('REDIRECT_URI'),
  })
  Deno.serve(
    { port: Number(Deno.env.get('PORT') ?? '9200') },
    (request) => partner.visit(request),
  )
}
