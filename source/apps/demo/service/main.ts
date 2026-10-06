/**
 * A stand-in for a service behind khatm: asks khatm who the visitor is, the
 * way a guard does, and shows what came back.
 */
class Service {
  constructor(
    /** khatm's internal get-session address. */
    private readonly introspectionURL: string,
    /** khatm's internal sign-out address. */
    private readonly signOutURL: string,
    /** khatm's public sign-in page. */
    private readonly loginURL: string,
  ) {}

  async visit(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/logout' && request.method === 'POST') {
      return await this.signOut(request)
    }
    if (pathname !== '/') return new Response('Not found', { status: 404 })

    const session = await this.introspect(request.headers.get('cookie'))
    const page = session ? this.signedIn(session) : this.signedOut(request.url)
    return new Response(layout(page), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  /**
   * Ends the session at khatm and hands its cookie-clearing headers back to
   * the browser. The cookie lives on the shared parent domain, so this host
   * can clear it. Better Auth only accepts the call from a trusted origin,
   * which this service is, as a first-party app.
   */
  private async signOut(request: Request): Promise<Response> {
    const headers = new Headers({ location: '/' })
    const cookie = request.headers.get('cookie')
    if (!cookie) return new Response(null, { status: 303, headers })

    const response = await fetch(this.signOutURL, {
      method: 'POST',
      headers: {
        cookie,
        origin: new URL(request.url).origin,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    await response.body?.cancel()
    for (const setCookie of response.headers.getSetCookie()) {
      headers.append('set-cookie', setCookie)
    }
    return new Response(null, { status: 303, headers })
  }

  /** Better Auth's session for this cookie, or `null` when there is none. */
  private async introspect(cookie: string | null): Promise<unknown> {
    if (!cookie) return null
    const response = await fetch(this.introspectionURL, {
      headers: { cookie },
    })
    if (!response.ok) return null
    return await response.json()
  }

  private signedIn(session: unknown): string {
    return `<p class="status in">Signed in</p>
<form method="post" action="/logout"><button class="button" type="submit">Sign out</button></form>
<p>This is everything khatm told the service about you:</p>
<pre>${escape(JSON.stringify(session, null, 2))}</pre>`
  }

  private signedOut(here: string): string {
    const login = new URL(this.loginURL)
    login.searchParams.set('return_to', here)
    return `<p class="status out">Not signed in</p>
<a class="button" href="${escape(login.href)}">Sign in</a>`
  }
}

function layout(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo service</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 3rem auto; padding: 0 1rem; }
  .status { font-weight: 600; font-size: 1.25rem; }
  .in { color: #15803d; }
  .out { color: #b91c1c; }
  .button { border: 0; font: inherit; cursor: pointer; display: inline-block; padding: .5rem 1rem; background: #111827; color: #fff; border-radius: .375rem; text-decoration: none; }
  pre { background: #f3f4f6; padding: 1rem; border-radius: .375rem; overflow-x: auto; }
</style>
</head>
<body>
<h1>Demo service</h1>
${body}
</body>
</html>`
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

if (import.meta.main) {
  const introspectionURL = Deno.env.get('INTROSPECTION_URL')
  const signOutURL = Deno.env.get('SIGN_OUT_URL')
  const loginURL = Deno.env.get('LOGIN_URL')
  if (!introspectionURL || !signOutURL || !loginURL) {
    console.error('INTROSPECTION_URL, SIGN_OUT_URL and LOGIN_URL must be set')
    Deno.exit(1)
  }
  const service = new Service(introspectionURL, signOutURL, loginURL)
  Deno.serve(
    { port: Number(Deno.env.get('PORT') ?? '9100') },
    (request) => service.visit(request),
  )
}
