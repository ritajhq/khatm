import { assert, assertEquals } from '@std/assert'
import type { Application, Placed } from '@khatm/spec'
import { type Auth, createAuth } from './create-auth.ts'
import { runMigrations } from './migrations.ts'
import { OAuthClients } from './oauth-clients.ts'
import {
  BASE_URL,
  fakeSource,
  resolvedSqlite,
  secretValues,
  signUp,
} from './test-support.ts'

const REDIRECT = 'http://partner.localhost/callback'
const CLIENT_SECRET = 'partner-client-secret-with-plenty-of-entropy'
const VERIFIER = 'a-pkce-code-verifier-that-is-long-enough-to-be-valid-43chars'

const APPLICATIONS: Placed<Application>[] = [
  { kind: 'first-party', id: 'dashboard', origin: 'http://localhost:3000' },
  {
    kind: 'oauth',
    id: 'partner',
    redirectUris: [REDIRECT],
    scopes: ['openid', 'email', 'profile'],
    confidential: true,
    clientSecret: { env: 'PARTNER_SECRET' },
  },
]

async function withOAuth(
  run: (auth: Auth, clients: OAuthClients) => Promise<void>,
): Promise<void> {
  const dir = Deno.makeTempDirSync({ prefix: 'khatm-oauth-' })
  const source = fakeSource({
    ...secretValues(`${dir}/auth.db`),
    PARTNER_SECRET: CLIENT_SECRET,
  })
  const resolved = resolvedSqlite({ applications: APPLICATIONS })
  await runMigrations(resolved, source)
  const { auth, close } = createAuth(resolved, source, { quiet: true })
  try {
    const clients = new OAuthClients(auth, source)
    await clients.sync(resolved.auth.applications)
    await run(auth, clients)
  } finally {
    await close()
    Deno.removeSync(dir, { recursive: true })
  }
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function authorizeURL(): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'partner',
    redirect_uri: REDIRECT,
    scope: 'openid email',
    state: 'state-1',
    code_challenge: await challenge(VERIFIER),
    code_challenge_method: 'S256',
  })
  return `${BASE_URL}/api/auth/oauth2/authorize?${query}`
}

function codeFrom(location: string | null): string {
  assert(location?.startsWith(REDIRECT), `Not sent back: ${location}`)
  const url = new URL(location!)
  assertEquals(url.searchParams.get('state'), 'state-1')
  return url.searchParams.get('code')!
}

function exchange(auth: Auth, code: string, secret: string) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`partner:${secret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }),
    }),
  )
}

Deno.test('OAuthClients: a declared confidential app signs a user in with a code, PKCE and its secret', async () => {
  await withOAuth(async (auth) => {
    const cookie = await signUp(auth)
    const authorized = await auth.handler(
      new Request(await authorizeURL(), { headers: { cookie } }),
    )
    const code = codeFrom(authorized.headers.get('location'))

    const tokens = await exchange(auth, code, CLIENT_SECRET)
    assertEquals(tokens.status, 200, await tokens.clone().text())
    const body = await tokens.json()
    assert(body.access_token)
    assert(body.id_token)
    const claims = JSON.parse(atob(
      body.id_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'),
    ))
    assertEquals(claims.iss, `${BASE_URL}/api/auth`)
    assertEquals(claims.aud, 'partner')
    assert(claims.sub)

    const userinfo = await auth.handler(
      new Request(`${BASE_URL}/api/auth/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${body.access_token}` },
      }),
    )
    const info = await userinfo.json()
    assertEquals(info.sub, claims.sub)
    assertEquals(info.email, 'ada@example.com')
  })
})

Deno.test('OAuthClients: the wrong client secret gets no tokens', async () => {
  await withOAuth(async (auth) => {
    const cookie = await signUp(auth)
    const authorized = await auth.handler(
      new Request(await authorizeURL(), { headers: { cookie } }),
    )
    const code = codeFrom(authorized.headers.get('location'))
    const tokens = await exchange(auth, code, 'not-the-secret')
    assertEquals(tokens.status, 401)
    await tokens.body?.cancel()
  })
})

Deno.test('OAuthClients: signed out, authorize sends the user to the login page, and signing in there resumes it', async () => {
  await withOAuth(async (auth) => {
    await signUp(auth)
    const authorized = await auth.handler(new Request(await authorizeURL()))
    const login = new URL(
      authorized.headers.get('location')!,
      BASE_URL,
    )
    assertEquals(login.pathname, '/login')
    assert(login.searchParams.get('sig'), 'The query is signed')

    // What the login page's auth client sends: the page's own query.
    const signedIn = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL },
        body: JSON.stringify({
          email: 'ada@example.com',
          password: 'a-long-enough-password',
          oauth_query: login.search.slice(1),
        }),
      }),
    )
    assertEquals(signedIn.status, 200)
    const { url } = await signedIn.json()
    const tokens = await exchange(auth, codeFrom(url), CLIENT_SECRET)
    assertEquals(tokens.status, 200)
    await tokens.body?.cancel()
  })
})

Deno.test('OAuthClients: an app dropped from the manifest is deleted on the next sync', async () => {
  await withOAuth(async (auth, clients) => {
    await clients.sync([APPLICATIONS[0], {
      ...APPLICATIONS[1] as Extract<Placed<Application>, { kind: 'oauth' }>,
      id: 'other',
    }])
    const cookie = await signUp(auth)
    const authorized = await auth.handler(
      new Request(await authorizeURL(), { headers: { cookie } }),
    )
    const location = authorized.headers.get('location') ?? ''
    assert(
      !location.includes('code='),
      `A deleted client still got a code: ${location}`,
    )
    await authorized.body?.cancel()
  })
})
