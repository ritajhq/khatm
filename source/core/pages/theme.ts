import { TokenName, TokenValue } from '@khatm/spec'

/**
 * The branding tokens as one CSS rule on `:root`. Names and values were
 * validated when the manifest was parsed; this checks again, since it writes
 * into a stylesheet, and drops what does not pass.
 */
export function themeCss(tokens: Readonly<Record<string, string>>): string {
  const declarations = Object.entries(tokens)
    .filter(([name, value]) =>
      TokenName.safeParse(name).success && TokenValue.safeParse(value).success
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `--${name}:${value};`)
  return declarations.length === 0 ? '' : `:root{${declarations.join('')}}`
}
