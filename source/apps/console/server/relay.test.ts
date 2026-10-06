import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert'
import { Calls, Rejected } from '@khatm/contract/messages'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { Client as HttpCourier } from '@ritaj/mux/client/http'
import { createConsoleHandler } from './server.ts'

const SESSION = 'better-auth.session_token'

/** A built app's three files, enough for the console to start. */
function fakeDist(): string {
  const dir = Deno.makeTempDirSync()
  for (const name of ['index.html', 'main.js', 'index.css']) {
    Deno.writeTextFileSync(`${dir}/${name}`, '')
  }
  return dir
}

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Deno.serve({ port: 0, onListen: () => {} }, handler)
  return { server, url: `http://localhost:${server.addr.port}` }
}

/**
 * A console in front of a stand-in control API that answers like the real
 * one behind its guard: no session, 401; `khatm.apply` unconfirmed, 409 with
 * the steps to confirm.
 */
async function withConsole(
  test: (url: string, seen: string[]) => Promise<void>,
) {
  const seen: string[] = []
  const session = serve((request) =>
    Response.json(
      request.headers.get('cookie') === `${SESSION}=good`
        ? {
          user: { id: 'ada', email: 'ada@example.com' },
          session: { expiresAt: '2999-01-01T00:00:00Z' },
        }
        : null,
    )
  )
  const control = serve(async (request) => {
    const name = new URL(request.url).pathname.slice(1)
    seen.push(`${name} ${request.headers.get('cookie') ?? '-'}`)
    if (request.headers.get('cookie') !== `${SESSION}=good`) {
      return Response.json({
        error: { code: 'unauthenticated', message: 'Sign in first' },
      }, { status: 401 })
    }
    const body = await request.json()
    if (name === 'khatm.apply' && !body.confirmed) {
      return Response.json({
        error: {
          code: 'confirmation_required',
          message: 'Destructive',
          steps: [{
            path: 'auth.plugins[username]',
            impact: 'destructive',
            reason: 'drops a column',
          }],
        },
      }, { status: 409 })
    }
    return Response.json({})
  })
  const dist = fakeDist()
  const console = serve(
    await createConsoleHandler({
      dist,
      loginDist: dist,
      controlUrl: control.url,
      sessionUrl: `${session.url}/api/auth/get-session`,
    }),
  )
  try {
    await test(console.url, seen)
  } finally {
    for (const { server } of [session, control, console]) {
      await server.shutdown()
    }
    Deno.removeSync(dist, { recursive: true })
  }
}

Deno.test('relay: a call reaches the control API with the session its sender presented', () =>
  withConsole(async (url, seen) => {
    const courier = new HttpCourier(`${url}/control`)
    const client = new Horizon.Client(courier)
    courier.Carry(new MUX.Credentials.Cookie(SESSION, 'good'))
    assertEquals(await client.Dispatch(new Calls.status({})), {})
    assertEquals(seen, [`khatm.status ${SESSION}=good`])
  }))

Deno.test('relay: refused on the way, the call comes back as the same Returned', () =>
  withConsole(async (url) => {
    const courier = new HttpCourier(`${url}/control`)
    const refused: (MUX.Credential | undefined)[] = []
    courier.OnCredentialRefused.Do((credential) => refused.push(credential))
    const error = await assertRejects(
      () => new Horizon.Client(courier).Dispatch(new Calls.status({})),
      Horizon.Undelivered,
    )
    assertInstanceOf(error.Returned, MUX.Unauthenticated)
    assertEquals(refused, [undefined])
  }))

Deno.test('relay: rejected by the control API, the call ends with Rejected, steps and all', () =>
  withConsole(async (url) => {
    const courier = new HttpCourier(`${url}/control`)
    courier.Carry(new MUX.Credentials.Cookie(SESSION, 'good'))
    const outcome = await new Horizon.Client(courier).Attempt(
      new Calls.apply({ manifest: {} }),
    )
    if (outcome.ok) throw new Error('expected a fault')
    assertInstanceOf(outcome.fault, Rejected)
    assertEquals(outcome.fault.Code, 'confirmation_required')
    assertEquals(outcome.fault.Steps[0].path, 'auth.plugins[username]')
  }))

Deno.test("relay: a packet posted under another procedure's name is refused", () =>
  withConsole(async (url, seen) => {
    const response = await fetch(`${url}/control/khatm.status`, {
      method: 'POST',
      body: JSON.stringify(
        new Calls.removeUser({ user: 'ada', confirmed: true }).toJSON(),
      ),
    })
    assertEquals(response.status, 400)
    await response.body?.cancel()
    assertEquals(seen, [])
  }))
