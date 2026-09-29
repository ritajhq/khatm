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
    'console: two instances behind a guard configure auth and administer users',
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

      // The overview runs doctor against the serving revision.
      await page.goto(`${consoles[0]}/#/overview`)
      await page.getByRole('button', { name: 'Run checks' }).click()
      await page.getByText('Every secret resolves').waitFor()
      if (shots) {
        await page.screenshot({
          path: `${shots}/console-doctor.png`,
          fullPage: true,
        })
      }

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
      await page.getByLabel('Part').selectOption('card')
      await page.getByLabel('CSS property').fill('border-radius')
      await page.getByRole('button', { name: 'Add rule' }).click()
      await page.getByLabel('card border-radius').fill('0px')
      await page.getByLabel('Legal').fill(
        '<p>See the <a href="https://example.com/terms">terms</a></p>',
      )
      await preview.getByRole('link', { name: 'terms' }).waitFor()
      await expectInPreview(
        page,
        `getComputedStyle(document.querySelector('[data-khatm-part="card"]')).borderTopLeftRadius`,
        '0px',
      )
      // Markup the pages would refuse is flagged while typing.
      await page.getByLabel('Footer').fill('<img src=x>')
      await page.getByText("<img> isn't allowed").first().waitFor()
      await page.getByLabel('Footer').fill('')
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

      // The data plane: Bob signs up, an operator finds him, gives him a role and bans him.
      const bob = await fetch(`${auth}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: auth },
        body: JSON.stringify({
          email: 'bob@example.com',
          password: 'bobs-long-enough-password',
          name: 'Bob',
        }),
      })
      assertEquals(bob.status, 200)
      await bob.body?.cancel()
      const bobCookie = bob.headers.getSetCookie()
        .map((c) => c.split(';')[0]).join('; ')
      const bobSession = async () =>
        (await (await fetch(`${auth}/api/auth/get-session`, {
          headers: { cookie: bobCookie },
        })).json())?.user?.email

      await other.goto(`${consoles[1]}/#/users`)
      await other.getByLabel('Search by email').fill('bob')
      await other.getByRole('button', { name: 'Search' }).click()
      await other.getByRole('cell', { name: /bob@example.com/ }).click()
      const panel = other.getByLabel('User bob@example.com')
      await panel.getByLabel('Role').fill('editor')
      await panel.getByRole('button', { name: 'Set role' }).click()
      await panel.getByText('Role set to editor').waitFor()
      assertEquals(await bobSession(), 'bob@example.com')
      await panel.getByLabel('Ban reason').fill('spam')
      await panel.getByRole('button', { name: 'Ban', exact: true }).click()
      await panel.getByText('Banned and signed out').waitFor()
      assertEquals(await bobSession(), undefined)
      if (shots) {
        await other.screenshot({
          path: `${shots}/console-users.png`,
          fullPage: true,
        })
      }

      // The audit log names the operator, not khatm's service user.
      await other.goto(`${consoles[1]}/#/audit`)
      await other.getByRole('cell', { name: 'users.ban' }).waitFor()
      const ada = (await sessionUser(page, auth)).id
      const entries = await runtime.audit.list({ limit: 10 })
      assertEquals(
        entries.slice(0, 3).map((e) => [e.actor, e.action]),
        [
          [ada, 'users.ban'],
          [ada, 'users.setRole'],
          [ada, 'khatm.rollback'],
        ],
      )
      if (shots) {
        await other.screenshot({
          path: `${shots}/console-audit.png`,
          fullPage: true,
        })
      }

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

function expectPrimary(page: Page, value: string) {
  return expectInPreview(
    page,
    "getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()",
    value,
  )
}

async function expectInPreview(page: Page, expression: string, value: string) {
  for (let i = 0; i < 50; i++) {
    const frame = page.frame({ url: /\/preview\// })
    const current = await frame?.evaluate(expression).catch(() => undefined)
    if (current === value) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`The preview never showed ${value} for ${expression}`)
}
