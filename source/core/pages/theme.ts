import { CssProperty, PartName, TokenName, TokenValue } from '@khatm/spec'

type Declarations = Readonly<Record<string, string>>

function declarations(
  entries: Declarations,
  valid: (name: string) => boolean,
  prefix = '',
): string {
  return Object.entries(entries)
    .filter(([name, value]) =>
      valid(name) && TokenValue.safeParse(value).success
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${prefix}${name}:${value};`)
    .join('')
}

/**
 * The branding as one stylesheet: the tokens as custom properties on
 * `:root`, then each part's scoped declarations. Part rules are `:root`
 * qualified so they win over the pages' own utility classes. Names and
 * values were validated when the manifest was parsed; this checks again,
 * since it writes into a stylesheet, and drops what does not pass.
 */
export function themeCss(
  tokens: Declarations,
  parts: Readonly<Partial<Record<string, Declarations>>> = {},
): string {
  const root = declarations(
    tokens,
    (name) => TokenName.safeParse(name).success,
    '--',
  )
  const rules = Object.entries(parts)
    .filter(([part]) => PartName.safeParse(part).success)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([part, style]) => [
      part,
      declarations(
        style ?? {},
        (name) => CssProperty.safeParse(name).success,
      ),
    ])
    .filter(([, body]) => body !== '')
    .map(([part, body]) => `:root [data-khatm-part="${part}"]{${body}}`)
  return (root === '' ? '' : `:root{${root}}`) + rules.join('')
}
