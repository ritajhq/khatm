import { procedures } from '@khatm/contract'
import { PageConfig, renderPage } from '@khatm/pages'
import { BrandingSpec } from '@khatm/spec'

export interface ConsoleOptions {
  /** The built console: `index.html`, `main.js`, `main.css`. */
  readonly dist: string
  /** The built login app, for the branding preview. */
  readonly loginDist: string
  /** The control API, normally its idhn guard: `http://khatm-control-guard:8080`. */
  readonly controlUrl: string
  readonly fetch?: typeof fetch
}

const PROCEDURES: ReadonlySet<string> = new Set(
  Object.values(procedures).map((p) => p.name),
)

/** Only these reach the control API: the caller's credentials and the body's type. */
const RELAYED_HEADERS = ['cookie', 'authorization', 'content-type']

const TYPES: Readonly<Record<string, string>> = {
  'main.js': 'text/javascript; charset=utf-8',
  'main.css': 'text/css; charset=utf-8',
}

const CONSOLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

/**
 * The console's server. It keeps nothing between requests, so any number of
 * instances can run behind one address:
 *
 * - `GET /…` serves the single-page app;
 * - `POST /control/<procedure>` relays the call to the control API with the
 *   caller's session, and the control API's guard decides;
 * - `GET /preview/<page>?draft=…` renders a login page for a draft branding
 *   with the login app's own assets, without calling the auth server.
 */
export async function createConsoleHandler(
  options: ConsoleOptions,
): Promise<(request: Request) => Promise<Response>> {
  const send = options.fetch ?? fetch
  const index = await Deno.readTextFile(`${options.dist}/index.html`)
  const assets = new Map<string, string>()
  const loginAssets = new Map<string, string>()
  for (const name of Object.keys(TYPES)) {
    assets.set(name, await Deno.readTextFile(`${options.dist}/${name}`))
    loginAssets.set(
      name,
      await Deno.readTextFile(`${options.loginDist}/${name}`),
    )
  }
  const loginTemplate = await Deno.readTextFile(
    `${options.loginDist}/index.html`,
  )
  const controlUrl = options.controlUrl.replace(/\/$/, '')

  const asset = (files: Map<string, string>, name: string) =>
    files.has(name)
      ? new Response(files.get(name), {
        headers: { 'content-type': TYPES[name], 'cache-control': 'no-cache' },
      })
      : new Response('Not found', { status: 404 })

  return async (request) => {
    const { pathname, searchParams } = new URL(request.url)

    if (pathname.startsWith('/control/')) {
      const name = pathname.slice('/control/'.length)
      if (request.method !== 'POST') {
        return new Response('POST only', { status: 405 })
      }
      if (!PROCEDURES.has(name)) {
        return new Response('Not found', { status: 404 })
      }
      const headers = new Headers()
      for (const header of RELAYED_HEADERS) {
        const value = request.headers.get(header)
        if (value !== null) headers.set(header, value)
      }
      try {
        const answer = await send(`${controlUrl}/${name}`, {
          method: 'POST',
          headers,
          body: await request.arrayBuffer(),
        })
        return new Response(answer.body, {
          status: answer.status,
          headers: {
            'content-type': answer.headers.get('content-type') ??
              'application/json',
          },
        })
      } catch {
        return Response.json({
          error: {
            code: 'internal',
            message: 'The control API could not be reached',
          },
        }, { status: 502 })
      }
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Not found', { status: 404 })
    }
    if (pathname.startsWith('/assets/')) {
      return asset(assets, pathname.slice('/assets/'.length))
    }
    if (pathname.startsWith('/preview/_khatm/')) {
      return asset(loginAssets, pathname.slice('/preview/_khatm/'.length))
    }
    if (pathname.startsWith('/preview/')) {
      let draft: { config: unknown; tokens?: unknown; parts?: unknown }
      try {
        draft = JSON.parse(decodeBase64Url(searchParams.get('draft') ?? ''))
      } catch {
        return new Response('Bad draft', { status: 400 })
      }
      const config = PageConfig.safeParse(draft.config)
      const tokens = draft.tokens !== null && typeof draft.tokens === 'object'
        ? Object.fromEntries(
          Object.entries(draft.tokens).filter(([, v]) => typeof v === 'string'),
        ) as Record<string, string>
        : {}
      // Shape only: `themeCss` drops any part, property or value that isn't valid.
      const parts = BrandingSpec.shape.parts.safeParse(draft.parts)
      if (!config.success) return new Response('Bad draft', { status: 400 })
      const page = await renderPage(loginTemplate, config.data, tokens, {
        assetBase: '/preview/_khatm/',
        frameAncestors: "'self'",
        parts: parts.success ? parts.data : {},
      })
      return new Response(page.html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': page.csp,
          'cache-control': 'no-store',
        },
      })
    }
    return new Response(index, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CONSOLE_CSP,
        'x-frame-options': 'DENY',
        'cache-control': 'no-store',
      },
    })
  }
}

function decodeBase64Url(text: string): string {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
