import { assert, assertEquals } from '@std/assert'
import { chromium } from 'playwright-core'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest } from '@khatm/spec'
import { freePort } from '@khatm-libs/supervisor'
import { createRuntime } from './runtime.ts'

const CHROMIUM = '/opt/pw-browsers/chromium'
const DIST = new URL('../login/dist/index.html', import.meta.url).pathname
const WORKER = new URL('../worker/main.ts', import.meta.url).pathname
const available = (() => {
  try {
    Deno.statSync(CHROMIUM)
    Deno.statSync(DIST)
    return true
  } catch {
    return false
  }
})()

// The apps a user may be sent back to. Nothing listens there: the test
// intercepts the navigation and only looks at where it went.
const DASHBOARD = 'http://localhost:3901'
const ADMIN = 'http://localhost:3902'

Deno.test({
  name:
    'hosted pages: sign up, sign in by username, safe return_to, branding, in a real browser',
  ignore: !available,
  fn: async () => {
    const dir = Deno.makeTempDirSync()
    const port = freePort()
    const origin = `http://localhost:${port}`
    const values: Record<string, string> = {
      AUTH_SECRET: 'browser-test-secret-with-plenty-of-entropy-01',
      DATABASE: `${dir}/auth.db`,
    }
    const authored = (branding: Record<string, unknown>) => ({
      auth: {
        baseURL: origin,
        secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
        database: { dialect: 'sqlite', url: { env: 'DATABASE' } },
        emailAndPassword: { enabled: true },
        plugins: [{ kind: 'username' }],
        applications: [
          {
            kind: 'first-party',
            id: 'dashboard',
            origin: DASHBOARD,
            landing: true,
          },
          { kind: 'first-party', id: 'admin', origin: ADMIN },
        ],
        session: {
          introspectionURL: `${origin}/api/auth/get-session`,
          issuer: 'browser',
          claims: ['email', 'username'],
        },
      },
      branding,
    })
    const branding = {
      name: 'Acme',
      tokens: { primary: 'rgb(200, 0, 100)' },
      messages: {
        it: { 'signIn.title': 'Accedi', 'signIn.submit': 'Entra' },
      },
      parts: {
        card: { 'border-radius': '0px' },
        submit: { 'text-transform': 'uppercase' },
      },
      slots: {
        en: {
          legal:
            '<p>By signing in you accept the <a href="https://example.com/terms">terms</a>.</p>',
        },
        it: { legal: '<p>Accedendo accetti i termini.</p>' },
      },
    }
    const resolved = defaultRegistry().resolve(
      parseManifest(authored(branding)),
    )
    const runtime = await createRuntime({
      store: `${dir}/orchestrator.db`,
      artifactsDirectory: `${dir}/artifacts`,
      workerEntry: WORKER,
      workerEnv: values,
      secrets: { env: (name) => values[name], readFile: Deno.readTextFileSync },
      deployment: { health: { timeoutMs: 20_000, intervalMs: 100 } },
    })
    const server = runtime.proxy.serve({ port, hostname: '127.0.0.1' })
    const browser = await chromium.launch({ executablePath: CHROMIUM })
    try {
      await runtime.deployment.apply(
        await runtime.deployment.plan(resolved),
        { author: 'browser-test' },
      )

      const context = await browser.newContext({ locale: 'en-US' })
      const landed: string[] = []
      await context.route(/localhost:390\d/, (route) => {
        landed.push(route.request().url())
        return route.fulfill({ body: 'landed', contentType: 'text/plain' })
      })
      const page = await context.newPage()
      const problems: string[] = []
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
      page.on('pageerror', (e) => problems.push(String(e)))

      // Sign up, and land back on the app that sent us (the admin, not the landing app).
      await page.goto(
        `${origin}/signup?return_to=${encodeURIComponent(`${ADMIN}/users`)}`,
      )
      await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace')
      await page.getByLabel('Username', { exact: true }).fill('ada')
      await page.getByLabel('Email', { exact: true }).fill('ada@example.com')
      await page.getByLabel('Password', { exact: true }).fill(
        'a-long-enough-password',
      )
      await page.getByRole('button', { name: 'Create account' }).click()
      await page.waitForURL(`${ADMIN}/users`)
      assertEquals(landed, [`${ADMIN}/users`])

      const shots = Deno.env.get('KHATM_SCREENSHOTS')
      if (shots) {
        await page.goto(`${origin}/signup`)
        await page.screenshot({ path: `${shots}/sign-up.png` })
      }

      // Sign in with the username; a return_to to a stranger falls back to the landing app.
      const second = await context.newPage()
      await second.goto(
        `${origin}/login?return_to=${
          encodeURIComponent('https://evil.example.com/steal')
        }`,
      )
      assertEquals(await second.locator('h1').textContent(), 'Sign in')
      // The branding token reaches the page as a custom property.
      assertEquals(
        await second.evaluate(
          "getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()",
        ),
        'rgb(200, 0, 100)',
      )
      // Scoped CSS reaches its part, and the legal slot shows sanitized markup.
      assertEquals(
        await second.evaluate(
          `getComputedStyle(document.querySelector('[data-khatm-part="card"]')).borderTopLeftRadius`,
        ),
        '0px',
      )
      assertEquals(
        await second.getByRole('link', { name: 'terms' }).getAttribute('rel'),
        'noopener noreferrer',
      )
      if (shots) await second.screenshot({ path: `${shots}/sign-in.png` })
      await second.getByLabel('Email or username').fill('ada')
      await second.getByLabel('Password', { exact: true }).fill(
        'wrong-password-entirely',
      )
      await second.getByRole('button', { name: 'Sign in' }).click()
      await second.getByRole('alert').waitFor()
      await second.getByLabel('Password', { exact: true }).fill(
        'a-long-enough-password',
      )
      await second.getByRole('button', { name: 'Sign in' }).click()
      await second.waitForURL(`${DASHBOARD}/`)
      assert(!landed.some((url) => url.includes('evil')))

      // The session cookie the pages set is the one the API reads.
      const session = await context.request.get(
        `${origin}/api/auth/get-session`,
      )
      assertEquals((await session.json()).user.email, 'ada@example.com')

      // Copy comes from the branding when the browser's language has messages.
      const italian = await browser.newContext({ locale: 'it-IT' })
      const it = await italian.newPage()
      await it.goto(`${origin}/login`)
      assertEquals(await it.locator('h1').textContent(), 'Accedi')
      await it.getByRole('button', { name: 'Entra' }).waitFor()
      await it.getByText('Accedendo accetti i termini.').waitFor()
      await italian.close()

      // Headless: the API stays, the pages go.
      await runtime.deployment.apply(
        await runtime.deployment.plan(
          defaultRegistry().resolve(
            parseManifest(authored({ ...branding, pages: 'headless' })),
          ),
        ),
        { author: 'browser-test' },
      )
      const gone = await fetch(`${origin}/login`)
      assertEquals(gone.status, 404)
      await gone.body?.cancel()
      const ok = await fetch(`${origin}/api/auth/ok`)
      assertEquals(ok.status, 200)
      await ok.body?.cancel()

      assertEquals(problems, [])
      await context.close()
    } finally {
      await browser.close()
      await server.shutdown()
      await runtime.close()
      Deno.removeSync(dir, { recursive: true })
    }
  },
})
