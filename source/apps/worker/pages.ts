import { type PageConfig, themeCss } from '@khatm/pages'

export interface PagesOptions {
  /** The built login app: `index.html`, `main.js`, `main.css`. */
  readonly dist: string
  readonly config: PageConfig
  readonly tokens: Readonly<Record<string, string>>
}

const ASSETS: Readonly<Record<string, string>> = {
  'main.js': 'text/javascript; charset=utf-8',
  'main.css': 'text/css; charset=utf-8',
}

/** Paths that show a page; `/` goes to the sign-in page. */
const PAGES = new Set(['/login', '/signup', '/error'])

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

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

  const css = themeCss(options.tokens)
  // The config is JSON in a non-executing script tag; `<` is escaped so no
  // value in it can close the tag.
  const configJson = JSON.stringify(options.config).replaceAll('<', '\\u003c')
  const head = (css === '' ? '' : `<style id="khatm-theme">${css}</style>`) +
    `<script id="khatm-config" type="application/json">${configJson}</script>`
  const html = template
    .replace('<!--khatm:title-->', escapeHtml(options.config.name || 'Sign in'))
    .replace('<!--khatm:head-->', head)
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Only the theme rule above is inline, allowed by its hash.
    css === ''
      ? "style-src 'self'"
      : `style-src 'self' 'sha256-${await sha256Base64(css)}'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')

  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
    const { pathname } = new URL(request.url)
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
