import { type PageConfig, renderPage } from '@khatm/pages'

export interface PagesOptions {
  /** The built login app: `index.html`, `main.js`, `index.css`. */
  readonly dist: string
  readonly config: PageConfig
  readonly tokens: Readonly<Record<string, string>>
  readonly parts?: Readonly<
    Partial<Record<string, Readonly<Record<string, string>>>>
  >
}

const ASSETS: Readonly<Record<string, string>> = {
  'main.js': 'text/javascript; charset=utf-8',
  'index.css': 'text/css; charset=utf-8',
}

/** Paths that show a page; `/` goes to the sign-in page. */
const PAGES = new Set(['/login', '/signup', '/error'])

/**
 * Serves the hosted pages: the page HTML with the branding tokens and the
 * page config filled in, and the built script and stylesheet. Returns
 * `undefined` for paths that are not the pages', so the caller can go on to
 * Better Auth. Everything is read at start, so a request never touches disk.
 */
export async function loadPages(
  options: PagesOptions,
): Promise<(request: Request) => Response | undefined> {
  const template = await Deno.readTextFile(`${options.dist}/index.html`)
  const assets = new Map<string, string>()
  for (const name of Object.keys(ASSETS)) {
    assets.set(name, await Deno.readTextFile(`${options.dist}/${name}`))
  }

  const { html, csp } = await renderPage(
    template,
    options.config,
    options.tokens,
    { parts: options.parts },
  )

  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
    const { pathname } = new URL(request.url)
    // No icon yet: answer so browsers stop asking and logging a 404.
    if (pathname === '/favicon.ico') return new Response(null, { status: 204 })
    if (pathname === '/') {
      return new Response(null, {
        status: 302,
        headers: { location: '/login' },
      })
    }
    if (PAGES.has(pathname)) {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': csp,
          'x-frame-options': 'DENY',
          'referrer-policy': 'same-origin',
          'cache-control': 'no-store',
        },
      })
    }
    const asset = pathname.startsWith('/_khatm/')
      ? pathname.slice('/_khatm/'.length)
      : undefined
    if (asset !== undefined && assets.has(asset)) {
      return new Response(assets.get(asset), {
        headers: {
          'content-type': ASSETS[asset],
          'cache-control': 'no-cache',
        },
      })
    }
    return undefined
  }
}
