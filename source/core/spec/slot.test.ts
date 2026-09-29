import { assertEquals } from '@std/assert'
import { sanitizeSlot } from './slot.ts'
import { BrandingSpec } from './branding.ts'

Deno.test('sanitizeSlot: keeps the allowed markup and links as written', () => {
  const input =
    '<p>By signing in you accept our <a href="https://example.com/terms">terms</a> &amp; <strong>privacy</strong> rules.<br>Questions? <a href="mailto:help@example.com">Mail us</a></p>'
  const { html, problems } = sanitizeSlot(input)
  assertEquals(problems, [])
  assertEquals(
    html,
    '<p>By signing in you accept our <a href="https://example.com/terms" rel="noopener noreferrer">terms</a> &amp; <strong>privacy</strong> rules.<br>Questions? <a href="mailto:help@example.com" rel="noopener noreferrer">Mail us</a></p>',
  )
})

Deno.test('sanitizeSlot: nothing that runs or styles survives, and says why', () => {
  const cases: [string, string][] = [
    ['<script>alert(1)</script>ok', 'ok'],
    ['<img src=x onerror=alert(1)>ok', 'ok'],
    [
      '<a href="javascript:alert(1)">x</a>',
      '<a rel="noopener noreferrer">x</a>',
    ],
    [
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a rel="noopener noreferrer">x</a>',
    ],
    ['<a href="//evil.example">x</a>', '<a rel="noopener noreferrer">x</a>'],
    ['<p onclick="x()" style="color:red">hi</p>', '<p>hi</p>'],
    ['<style>body{display:none}</style>hi', 'hi'],
    ['<svg><script>alert(1)</script></svg>hi', 'hi'],
  ]
  for (const [input, expected] of cases) {
    const { html, problems } = sanitizeSlot(input)
    assertEquals(html, expected, input)
    assertEquals(problems.length > 0, true, input)
  }
})

Deno.test('sanitizeSlot: odd input comes out as text, and tags are balanced', () => {
  assertEquals(
    sanitizeSlot('a < b > c "q"').html,
    'a &lt; b &gt; c &quot;q&quot;',
  )
  assertEquals(
    sanitizeSlot('<a href="/x">unclosed').html,
    '<a href="/x" rel="noopener noreferrer">unclosed</a>',
  )
  assertEquals(sanitizeSlot('</p>stray<b>x</i>').html, 'stray<b>x</b>')
  assertEquals(sanitizeSlot('<!-- note -->kept').html, 'kept')
  assertEquals(sanitizeSlot('<p title="a>b">t</p>').html, '<p>t</p>')
})

Deno.test('BrandingSpec: rejects slots that would lose markup and parts outside the list', () => {
  assertEquals(
    BrandingSpec.safeParse({
      slots: {
        en: { footer: '<p>fine <a href="https://x.example">x</a></p>' },
      },
      parts: { card: { 'border-radius': '0', '--gap': '2rem' } },
      pages: 'headless',
    }).success,
    true,
  )
  for (
    const bad of [
      { slots: { en: { footer: '<img src=x>' } } },
      { slots: { en: { sidebar: 'x' } } },
      { parts: { body: { color: 'red' } } },
      { parts: { card: { color: 'red;background:url(x)' } } },
      { parts: { card: { 'Color': 'red' } } },
    ]
  ) {
    assertEquals(
      BrandingSpec.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    )
  }
})
