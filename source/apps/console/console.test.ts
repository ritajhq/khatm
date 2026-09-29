import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { chromium, type Page } from 'playwright-core'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest } from '@khatm/spec'
import { freePort } from '@khatm-libs/supervisor'
import {
  ControlService,
  createRuntime,
  serveControl,
} from '@khatm/orchestrator'
import { createConsoleHandler } from './server.ts'

const CHROMIUM = '/opt/pw-browsers/chromium'
const here = (path: string) => new URL(path, import.meta.url).pathname
const WORKER = here('../worker/main.ts')
const available = [
  CHROMIUM,
  here('./dist/index.html'),
  here('../login/dist/index.html'),
]
  .every((path) => {
    try {
      Deno.statSync(path)
      return true
    } catch {
      return false
    }
  })

/**
 * Stands in for idhn's guard at its `authn-only` level: asks the auth server
 * who the cookie belongs to, drops any `x-idhn-*` the caller sent, and sets
 * `x-idhn-subject`. The real guard is checked against the shipped manifests
 * in core/contract; this keeps the test inside the repository.
 */
function guard(upstream: string, sessionUrl: string) {
  return async (request: Request): Promise<Response> => {
    const cookie = request.headers.get('cookie') ?? ''
    const session = cookie
      ? await (await fetch(sessionUrl, { headers: { cookie } })).json()
      : null
    if (!session?.user?.id) {
      return Response.json(
        { error: { code: 'unauthenticated', message: 'Sign in first' } },
        { status: 401 },
      )
    }
    const headers = new Headers(request.headers)
    for (const name of [...headers.keys()]) {
      if (name.startsWith('x-idhn-')) headers.delete(name)
    }
    headers.set('x-idhn-subject', session.user.id)
    const url = new URL(request.url)
    return await fetch(`${upstream}${url.pathname}`, {
      method: request.method,
      headers,
      body: await request.arrayBuffer(),
    })
  }
}

Deno.test({
  name:
    'console: two instances behind a guard plan, apply, roll back and preview branding',
  ignore: !available,
  fn: async () => {
    const dir = Deno.makeTempDirSync()
    const authPort = freePort()
    const auth = `http://localhost:${authPort}`
    const values: Record<string, string> = {
      AUTH_SECRET: 'console-test-secret-with-plenty-of-entropy-01',
      DATABASE: `${dir}/auth.db`,
    }
    const authored = {
      auth: {
        baseURL: auth,
        secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
        database: { dialect: 'sqlite', url: { env: 'DATABASE' } },
        emailAndPassword: { enabled: true },
        applications: [],
        session: {
          introspectionURL: `${auth}/api/auth/get-session`,
          issuer: 'console',
          claims: ['email'],
        },
      },
    }
    const runtime = await createRuntime({
      store: `${dir}/orchestrator.db`,
      artifactsDirectory: `${dir}/artifacts`,
      workerEntry: WORKER,
      workerEnv: values,
      secrets: { env: (name) => values[name], readFile: Deno.readTextFileSync },
      deployment: { health: { timeoutMs: 20_000, intervalMs: 100 } },
    })
    const servers: Deno.HttpServer[] = []
    const listen = (handler: (r: Request) => Response | Promise<Response>) => {
      const server = Deno.serve(
        { port: 0, hostname: '127.0.0.1', onListen: () => {} },
        handler,
      )
      servers.push(server)
      return `http://localhost:${(server.addr as Deno.NetAddr).port}`
    }
    servers.push(runtime.proxy.serve({ port: authPort, hostname: '127.0.0.1' }))
    const control = serveControl(
      new ControlService(runtime, runtime.events),
      { port: 0, hostname: '127.0.0.1' },
    )
    servers.push(control)
    const controlGuard = listen(guard(
      `http://127.0.0.1:${(control.addr as Deno.NetAddr).port}`,
      `${auth}/api/auth/get-session`,
    ))
    const consoles: string[] = []
    for (let i = 0; i < 2; i++) {
      consoles.push(listen(
        await createConsoleHandler({
          dist: here('./dist'),
          loginDist: here('../login/dist'),
          controlUrl: controlGuard,
        }),
      ))
    }
    const browser = await chromium.launch({ executablePath: CHROMIUM })
    try {
      const first = await runtime.deployment.apply(
        await runtime.deployment.plan(
          defaultRegistry().resolve(parseManifest(authored)),
          authored,
        ),
        { author: 'bootstrap' },
      )

      // Nobody signed in: the control API's guard refuses the console's relay.
      const anonymous = await fetch(`${consoles[0]}/control/khatm.status`, {
        method: 'POST',
        body: '{}',
      })
      assertEquals(anonymous.status, 401)
      await anonymous.body?.cancel()

      // Cookies ignore ports, so signing in on the auth origin signs the console in.
      const context = await browser.newContext()
      const page = await context.newPage()
      const problems: string[] = []
      page.on('pageerror', (e) => problems.push(String(e)))
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
      await page.goto(`${auth}/signup`)
      await page.getByLabel('Name', { exact: true }).fill('Ada')
      await page.getByLabel('Email', { exact: true }).fill('ada@example.com')
      await page.getByLabel('Password', { exact: true }).fill(
        'a-long-enough-password',
      )
      await page.getByRole('button', { name: 'Create account' }).click()
      await page.waitForURL(`${auth}/login`)

      // Console A: turn the username plugin on through its generated form, plan, apply.
      await page.goto(`${consoles[0]}/#/configuration`)
      await page.getByLabel('username', { exact: true }).check()
      await page.getByLabel('minUsernameLength (optional)').fill('4')
      assertStringIncludes(
        await page.getByLabel('Manifest JSON').inputValue(),
        '"minUsernameLength": 4',
      )
      await page.getByRole('button', { name: 'Plan' }).click()
      await page.getByText('auth.plugins[username]').waitFor()
      const shots = Deno.env.get('KHATM_SCREENSHOTS')
      if (shots) {
        await page.screenshot({
          path: `${shots}/console-plan.png`,
          fullPage: true,
        })
      }
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByText(/Applied as revision/).waitFor()
      const second = await runtime.store.active()
      assert(second?.revision.id !== first.revision.id)
      assertEquals(second?.revision.author, (await sessionUser(page, auth)).id)

      // Console B sees it, and rolls back; removing a plugin needs confirmation.
      const other = await context.newPage()
      await other.goto(`${consoles[1]}/#/revisions`)
      await other.getByText('(serving)').waitFor()
      await other.getByRole('button', { name: 'Roll back' }).click()
      await other.getByText(/is destructive/).waitFor()
      await other.getByRole('button', { name: 'Roll back anyway' }).click()
      await other.getByText(/Rolled back as revision/).waitFor()
      assertEquals(
        (await runtime.store.active())?.revision.manifest,
        first.revision.manifest,
      )

      // Branding: a draft reaches the preview without an apply.
      await page.goto(`${consoles[0]}/#/branding`)
      await page.getByLabel('Name', { exact: true }).fill('Acme')
      await page.getByLabel('New token name').fill('primary')
      await page.getByRole('button', { name: 'Add token' }).click()
      await page.getByLabel('--primary').fill('rgb(10, 120, 30)')
      const preview = page.frameLocator('iframe[title="Login page preview"]')
      await preview.getByText('Acme').waitFor()
      await expectPrimary(page, 'rgb(10, 120, 30)')
      if (shots) {
        await page.screenshot({
          path: `${shots}/console-branding.png`,
          fullPage: true,
        })
        await other.screenshot({
          path: `${shots}/console-revisions.png`,
          fullPage: true,
        })
      }
      assertEquals((await runtime.store.history()).length, 3)

      assertEquals(problems, [])
      await context.close()
    } finally {
      await browser.close()
      for (const server of servers) await server.shutdown()
      await runtime.close()
      Deno.removeSync(dir, { recursive: true })
    }
  },
})

async function sessionUser(page: Page, auth: string): Promise<{ id: string }> {
  const response = await page.context().request.get(
    `${auth}/api/auth/get-session`,
  )
  return (await response.json()).user
}

async function expectPrimary(page: Page, value: string) {
  const frame = page.frame({ url: /\/preview\// })!
  for (let i = 0; i < 50; i++) {
    const current = await frame.evaluate(
      "getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()",
    )
    if (current === value) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`The preview never showed --primary: ${value}`)
}
