import { type PageConfig, pageConfig } from '@khatm/pages'
import { defaultRegistry, UnresolvableManifestError } from '@khatm/registry'
import {
  InvalidManifestError,
  parseManifest,
  type ResolvedManifest,
} from '@khatm/spec'

/**
 * The manifest an operator is editing, before it is planned. The console has
 * one draft, edited as JSON or through forms, and checks it with the same
 * code the orchestrator runs, so most mistakes show up before any call.
 */
export type Authored = Record<string, unknown>

export type Checked =
  | { ok: true; authored: Authored; resolved: ResolvedManifest }
  | { ok: false; problems: string[] }

export function check(text: string): Checked {
  let authored: unknown
  try {
    authored = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      problems: [`Not JSON: ${error instanceof Error ? error.message : error}`],
    }
  }
  if (
    authored === null || typeof authored !== 'object' || Array.isArray(authored)
  ) {
    return { ok: false, problems: ['The manifest must be a JSON object'] }
  }
  try {
    const resolved = defaultRegistry().resolve(parseManifest(authored))
    return { ok: true, authored: authored as Authored, resolved }
  } catch (error) {
    if (
      error instanceof InvalidManifestError ||
      error instanceof UnresolvableManifestError
    ) {
      return { ok: false, problems: error.problems }
    }
    return { ok: false, problems: [String(error)] }
  }
}

export function format(authored: Authored): string {
  return JSON.stringify(authored, null, 2)
}

interface PluginEntry {
  kind: string
  options?: Record<string, unknown>
}

function auth(authored: Authored): Record<string, unknown> {
  const value = authored.auth
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

/** The authored plugin entries, whatever shape the draft is in. */
export function plugins(authored: Authored): PluginEntry[] {
  const list = auth(authored).plugins
  return Array.isArray(list)
    ? list.filter((p): p is PluginEntry =>
      p !== null && typeof p === 'object' && typeof p.kind === 'string'
    )
    : []
}

/** Turns a plugin on with these options, changes its options, or turns it off (`undefined`). */
export function withPlugin(
  authored: Authored,
  kind: string,
  options: Record<string, unknown> | undefined,
): Authored {
  const others = plugins(authored).filter((p) => p.kind !== kind)
  const next = options === undefined ? others : [
    ...others,
    Object.keys(options).length === 0 ? { kind } : { kind, options },
  ]
  return { ...authored, auth: { ...auth(authored), plugins: next } }
}

export interface Branding {
  name?: string
  tokens: Record<string, string>
  messages: Record<string, Record<string, string>>
}

export function branding(authored: Authored): Branding {
  const value = authored.branding as Partial<Branding> | undefined
  return {
    ...(value?.name ? { name: value.name } : {}),
    tokens: { ...(value?.tokens ?? {}) },
    messages: { ...(value?.messages ?? {}) },
  }
}

export function withBranding(authored: Authored, next: Branding): Authored {
  const { name, ...rest } = next
  return { ...authored, branding: name ? { name, ...rest } : rest }
}

/** What the preview frame needs, as the `draft` query parameter. */
export function previewQuery(resolved: ResolvedManifest): string {
  const draft: { config: PageConfig; tokens: Record<string, string> } = {
    config: pageConfig(resolved),
    tokens: resolved.branding.tokens,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(draft))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
