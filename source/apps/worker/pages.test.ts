import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { PageConfig } from '@khatm/pages'
import { createHandler } from './handler.ts'
import { loadPages } from './pages.ts'

const config: PageConfig = {
  name: 'Acme </title><script>alert(1)</script>',
  emailAndPassword: { enabled: true, requireVerification: false },
  username: false,
  socialProviders: [],
  returnOrigins: ['https://app.example.com'],
  landing: 'https://app.example.com',
  messages: { en: { 'signIn.title': '</script><img src=x onerror=alert(1)>' } },
  slots: {},
}

async function serve(tokens: Record<string, string> = {}) {
  const dist = Deno.makeTempDirSync()
  Deno.writeTextFileSync(
    `${dist}/index.html`,
    '<title><!--khatm:title--></title><head><!--khatm:head--></head>',
  )
  Deno.writeTextFileSync(`${dist}/main.js`, 'console.log(1)')
  Deno.writeTextFileSync(`${dist}/main.css`, 'body{}')
  Deno.writeTextFileSync(`${dist}/secret.txt`, 'nope')
  const pages = await loadPages({ dist, config, tokens })
  const auth = { handler: () => Promise.resolve(new Response('auth')) }
  const handle = createHandler(auth, { origins: [] }, pages)
  return {
    call: (path: string, init?: RequestInit) =>
      handle(new Request(`http://127.0.0.1:1${path}`, init)),
    cleanup: () => Deno.removeSync(dist, { recursive: true }),
  }
}

Deno.test('pages: sign-in, sign-up and error render the same document with theme and config', async () => {
  const t = await serve({ primary: 'oklch(0.5 0.2 250)' })
  try {
    for (const path of ['/login', '/signup', '/error']) {
      const response = await t.call(path)
      assertEquals(response.status, 200)
      const html = await response.text()
      assertStringIncludes(html, ':root{--primary:oklch(0.5 0.2 250);}')
      assertStringIncludes(
        html,
        '<script id="khatm-config" type="application/json">',
      )
      assertEquals(response.headers.get('x-frame-options'), 'DENY')
    }
    const redirect = await t.call('/')
    assertEquals(redirect.status, 302)
    assertEquals(redirect.headers.get('location'), '/login')
  } finally {
    t.cleanup()
  }
})

Deno.test('pages: nothing in the config or name can break out of its tag', async () => {
  const t = await serve()
  try {
    const html = await (await t.call('/login')).text()
    assert(!html.includes('<script>alert(1)'))
    assert(!html.includes('</script><img'))
    assertStringIncludes(html, '&lt;/title&gt;&lt;script&gt;')
    const json = html.match(
      /id="khatm-config" type="application\/json">(.*?)<\/script>/s,
    )![1]
    assertEquals(JSON.parse(json), config)
  } finally {
    t.cleanup()
  }
})

Deno.test('pages: the content security policy allows the theme rule by its hash and no other inline style', async () => {
  const themed = await serve({ primary: 'red' })
  const plain = await serve()
  try {
    const csp = (await themed.call('/login')).headers.get(
      'content-security-policy',
    )!
    assertStringIncludes(csp, "script-src 'self'")
    assertStringIncludes(csp, "style-src 'self' 'sha256-")
    assertStringIncludes(csp, "frame-ancestors 'none'")
    assertEquals(
      (await plain.call('/login')).headers.get('content-security-policy')!
        .includes("style-src 'self';"),
      true,
    )
  } finally {
    themed.cleanup()
    plain.cleanup()
  }
})

Deno.test('pages: serves the built assets and nothing else from the directory', async () => {
  const t = await serve()
  try {
    const js = await t.call('/_khatm/main.js')
    assertEquals(
      js.headers.get('content-type'),
      'text/javascript; charset=utf-8',
    )
    assertEquals(await js.text(), 'console.log(1)')
    assertEquals(await (await t.call('/_khatm/main.css')).text(), 'body{}')
    assertEquals((await t.call('/_khatm/secret.txt')).status, 404)
    assertEquals((await t.call('/_khatm/../secret.txt')).status, 404)
    assertEquals(await (await t.call('/api/auth/ok')).text(), 'auth')
    // A POST to a page path is not a page.
    assertEquals((await t.call('/login', { method: 'POST' })).status, 404)
  } finally {
    t.cleanup()
  }
})
