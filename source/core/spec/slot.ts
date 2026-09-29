/**
 * Slot markup: the small HTML an operator may put in the hosted pages'
 * header, footer and legal text. The output is rebuilt from scratch, never
 * copied: allowed tags are written out again with only their allowed
 * attributes, and everything else is escaped text. So what reaches a page is
 * safe however odd the input, and the parser only has to be good enough to
 * keep the operator's intent.
 */

/** Tags a slot may use, and none of them may carry anything but `a`'s `href`. */
const ALLOWED = new Set([
  'a',
  'b',
  'br',
  'em',
  'i',
  'li',
  'ol',
  'p',
  'small',
  'span',
  'strong',
  'ul',
])

/** Tags whose content is dropped with them, since it isn't text. */
const DROP_CONTENT = new Set(['script', 'style', 'template', 'iframe', 'svg'])

/** Plain web and mail links, or paths on the same site. Nothing that runs. */
const HREF = /^(https?:\/\/|mailto:|\/(?!\/))[^\s"'<>\\`]*$/i

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const ATTRIBUTE =
  /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const ENTITY = /&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y

export const MAX_SLOT_LENGTH = 4000

export interface SanitizedSlot {
  readonly html: string
  /** What was dropped, for telling the operator; empty when nothing was. */
  readonly problems: string[]
}

function escapeText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '&') {
      ENTITY.lastIndex = i
      const entity = ENTITY.exec(text)
      if (entity) {
        out += entity[0]
        i += entity[0].length - 1
      } else out += '&amp;'
    } else if (c === '<') out += '&lt;'
    else if (c === '>') out += '&gt;'
    else if (c === '"') out += '&quot;'
    else out += c
  }
  return out
}

export function sanitizeSlot(input: string): SanitizedSlot {
  const problems: string[] = []
  const open: string[] = []
  let html = ''
  let dropping: string | undefined
  let last = 0

  const text = (chunk: string) => {
    if (dropping === undefined) html += escapeText(chunk)
  }

  for (const match of input.matchAll(TOKEN)) {
    text(input.slice(last, match.index))
    last = match.index + match[0].length
    if (match[0].startsWith('<!--')) continue
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()

    if (dropping !== undefined) {
      if (closing && tag === dropping) dropping = undefined
      continue
    }
    if (DROP_CONTENT.has(tag)) {
      problems.push(`<${tag}> isn't allowed, and its content was dropped`)
      if (!closing) dropping = tag
      continue
    }
    if (!ALLOWED.has(tag)) {
      if (!closing) problems.push(`<${tag}> isn't allowed`)
      continue
    }
    if (closing) {
      const at = open.lastIndexOf(tag)
      if (at === -1) continue
      while (open.length > at) html += `</${open.pop()}>`
      continue
    }

    let href: string | undefined
    for (const attribute of match[3].matchAll(ATTRIBUTE)) {
      const name = attribute[1].toLowerCase()
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? ''
      if (tag === 'a' && name === 'href' && HREF.test(value)) {
        href = value
      } else if (tag === 'a' && name === 'href') {
        problems.push(
          `The link ${JSON.stringify(value)} isn't http(s), mailto or a path`,
        )
      } else {
        problems.push(`<${tag}> can't have the "${name}" attribute`)
      }
    }
    if (tag === 'br') {
      html += '<br>'
      continue
    }
    html += tag === 'a'
      ? `<a${
        href === undefined ? '' : ` href="${escapeText(href)}"`
      } rel="noopener noreferrer">`
      : `<${tag}>`
    open.push(tag)
  }
  text(input.slice(last))
  while (open.length > 0) html += `</${open.pop()}>`
  return { html, problems }
}
