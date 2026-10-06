import type { PageConfig } from './page-config.ts'
import { themeCss } from './theme.ts'

export interface RenderedPage {
  readonly html: string
  /** The Content-Security-Policy the page must be served with. */
  readonly csp: string
}

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
 * Fills the login app's HTML template with the branding theme and the page
 * config. Used by the worker for the real pages and by the console for its
 * preview, so both render the same document.
 *
 * `assetBase` is where `main.js` and `index.css` are served from.
 */
export async function renderPage(
  template: string,
  config: PageConfig,
  tokens: Readonly<Record<string, string>>,
  options: {
    assetBase?: string
    frameAncestors?: string
    /** Scoped CSS per stable part, from the branding. */
    parts?: Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>
  } = {},
): Promise<RenderedPage> {
  const css = themeCss(tokens, options.parts)
  // The config is JSON in a non-executing script tag; `<` is escaped so no
  // value in it can close the tag.
  const configJson = JSON.stringify(config).replaceAll('<', '\\u003c')
  const head = (css === '' ? '' : `<style id="khatm-theme">${css}</style>`) +
    `<script id="khatm-config" type="application/json">${configJson}</script>`
  const base = options.assetBase ?? '/_khatm/'
  const html = template
    .replaceAll('/_khatm/', base)
    .replace('<!--khatm:title-->', escapeHtml(config.name || 'Sign in'))
    .replace('<!--khatm:head-->', head)
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Only the theme stylesheet above is inline, allowed by its hash.
    css === ''
      ? "style-src 'self'"
      : `style-src 'self' 'sha256-${await sha256Base64(css)}'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    `frame-ancestors ${options.frameAncestors ?? "'none'"}`,
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  return { html, csp }
}
