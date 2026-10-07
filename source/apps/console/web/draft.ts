import { type PageConfig, pageConfig } from '@khatm/pages'
import { defaultRegistry, UnresolvableManifestError } from '@khatm/registry'
import {
  InvalidManifestError,
  isEnvRef,
  parseManifest,
  type PlacedManifest,
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
  /** `authored` is there when the draft is a JSON object, so editors can keep working on it. */
  | { ok: false; problems: string[]; authored?: Authored }

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
    const problems = error instanceof InvalidManifestError ||
        error instanceof UnresolvableManifestError
      ? error.problems
      : [String(error)]
    return { ok: false, problems, authored: authored as Authored }
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
  /** Scoped CSS: declarations per stable part. */
  parts: Record<string, Record<string, string>>
  /** Slot markup per locale, then per slot. */
  slots: Record<string, Record<string, string>>
  pages: 'hosted' | 'headless'
}

export function branding(authored: Authored): Branding {
  const value = authored.branding as
    | Partial<Omit<Branding, 'pages'>> & { pages?: string }
    | undefined
  return {
    ...(value?.name ? { name: value.name } : {}),
    tokens: { ...(value?.tokens ?? {}) },
    messages: { ...(value?.messages ?? {}) },
    parts: { ...(value?.parts ?? {}) },
    slots: { ...(value?.slots ?? {}) },
    pages: value?.pages === 'headless' ? 'headless' : 'hosted',
  }
}

/** Writes the branding back, leaving out what is empty or default so the manifest stays small. */
export function withBranding(authored: Authored, next: Branding): Authored {
  const { name, parts, slots, pages, ...rest } = next
  const nonEmpty = <T extends Record<string, Record<string, string>>>(
    value: T,
  ) =>
    Object.fromEntries(
      Object.entries(value).filter(([, inner]) =>
        Object.keys(inner).length > 0
      ),
    )
  const keptParts = nonEmpty(parts)
  const keptSlots = nonEmpty(slots)
  return {
    ...authored,
    branding: {
      ...(name ? { name } : {}),
      ...rest,
      ...(Object.keys(keptParts).length > 0 ? { parts: keptParts } : {}),
      ...(Object.keys(keptSlots).length > 0 ? { slots: keptSlots } : {}),
      ...(pages === 'headless' ? { pages } : {}),
    },
  }
}

/** What the preview frame needs, as the `draft` query parameter. */
export function previewQuery(resolved: ResolvedManifest): string {
  const draft: {
    config: PageConfig
    tokens: Record<string, string>
    parts: Record<string, Record<string, string>>
  } = {
    config: pageConfig(previewable(resolved)),
    tokens: resolved.branding.tokens,
    parts: resolved.branding.parts ?? {},
  }
  const bytes = new TextEncoder().encode(JSON.stringify(draft))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * `resolved` as the preview can show it: the browser has no deployment to
 * read references from, and the preview never sends anyone back to an app,
 * so apps whose origin comes from the deployment are left out.
 */
function previewable(resolved: ResolvedManifest): PlacedManifest {
  return {
    ...resolved,
    auth: {
      ...resolved.auth,
      applications: resolved.auth.applications.filter((app) =>
        app.kind !== 'first-party' || !isEnvRef(app.origin)
      ),
    },
  } as PlacedManifest
}
