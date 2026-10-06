import { procedures } from '@khatm/contract'
import * as Mechanisms from '@khatm/mechanisms'
import { PageConfig, renderPage } from '@khatm/pages'
import { BrandingSpec } from '@khatm/spec'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { Server as HttpTransport } from '@ritaj/mux/server/http'
import { Relay } from './relay.ts'

export interface ConsoleOptions {
  /** The built console: `index.html`, `main.js`, `index.css`. */
  readonly dist: string
  /** The built login app, for the branding preview. */
  readonly loginDist: string
  /** The control API, normally its idhn guard: `http://khatm-control-guard:8080`. */
  readonly controlUrl: string
  /** khatm's session endpoint, to tell who is calling: `http://khatm:4100/api/auth/get-session`. */
  readonly sessionUrl: string
}

const PROCEDURES: ReadonlySet<string> = new Set(
  Object.values(procedures).map((p) => p.name),
)

/** How long a control call may take: an apply or rollback waits for the new worker to pass its health checks. */
export const CALL_TIMEOUT_MS = 120_000

const TYPES: Readonly<Record<string, string>> = {
  'main.js': 'text/javascript; charset=utf-8',
  'index.css': 'text/css; charset=utf-8',
}

const CONSOLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Fluid's primitives (Radix, framer-motion) inject <style> elements at
  // runtime. Scripts stay 'self' only; the console renders no untrusted
  // markup itself (slot HTML is only shown in the preview frame, under the
  // login pages' own policy).
  "style-src 'self' 'unsafe-inline'",
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
 * - `POST /control/<procedure>` takes the call as a horizon message and
 *   relays it to the control API on behalf of its sender, with their
 *   session: the control API's guard decides (see Relay);
 * - `GET /preview/<page>?draft=…` renders a login page for a draft branding
 *   with the login app's own assets, without calling the auth server.
 */
export async function createConsoleHandler(
  options: ConsoleOptions,
): Promise<(request: Request) => Promise<Response>> {
  const transport = new HttpTransport(
    new MUX.Authentication([
      new Mechanisms.Session({ url: options.sessionUrl }),
    ]),
  )
  const resolvers = new Horizon.Resolvers()
  const handlers = new Horizon.Handlers()
  new Relay(options.controlUrl.replace(/\/$/, '')).Serve(resolvers, handlers)
  const horizon = new Horizon.Server(resolvers, handlers)
  horizon.OnCrashed.Do((message, error, incident) => {
    console.error(`[console] incident ${incident} handling`, message, error)
  })
  horizon.Use(transport)

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
      // Applying waits for the new worker to be healthy, well past mux's default.
      return await transport.Handle(request, { timeoutMs: CALL_TIMEOUT_MS })
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
