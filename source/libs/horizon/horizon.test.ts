import { assert, assertEquals, assertInstanceOf, assertRejects } from '@std/assert'

import * as MUX from '@ritaj/mux'
import { Client as HttpCourier } from '@ritaj/mux/client/http'
import { Server as HttpTransport } from '@ritaj/mux/server/http'
import { Client as WsCourier } from '@ritaj/mux/client/ws'
import { Server as WsTransport } from '@ritaj/mux/server/ws'

import * as Storage from '@ritaj/storage'

import * as Horizon from './index.ts'

// --- What the tests talk in -------------------------------------------------

type Who = { status: MUX.CallerStatus; subject?: string }

class WhoAmI extends Horizon.Query<Who> {}

class Taken extends Horizon.Fault {
  private readonly taken = this.c.String('', 'fault.taken.name')

  constructor(name = '') {
    super(`${name} is taken`)
    this.taken.Write(name)
  }

  get Name(): string {
    return this.taken.Read()
  }
}

class Rename extends Horizon.Action<string, Taken> {
  private readonly to = this.c.String('', 'action.rename.to')

  constructor(to = '') {
    super()
    this.to.Write(to)
  }

  get To(): string {
    return this.to.Read()
  }
}

class Explode extends Horizon.Action<undefined> {}

class Unknown extends Horizon.Query<string> {}

MUX.Packet.Register(WhoAmI, '/test.who_am_i')
MUX.Packet.Register(Rename, '/test.rename')
MUX.Packet.Register(Explode, '/test.explode')
MUX.Packet.Register(Unknown, '/test.unknown')
Horizon.Fault.Register(Taken, '/test.taken')

/** A stand-in for a mechanism khatm would provide: the session cookie `sid`, `bad` being invalid and `down` unverifiable. */
class Sessions implements MUX.Mechanism<MUX.Credentials.Cookie> {
  private readonly revoked = new Set<string>()

  constructor(private readonly expires?: () => Date) {}

  Revoke(sid: string) {
    this.revoked.add(sid)
  }

  Extract(envelope: MUX.Envelope) {
    const sid = envelope.Cookie('sid')
    return sid === undefined ? undefined : new MUX.Credentials.Cookie('sid', sid)
  }

  Verify(credential: MUX.Credentials.Cookie): Promise<MUX.Caller> {
    if (credential.Value === 'down') return Promise.reject(new Error('auth server down'))
    if (credential.Value === 'bad' || this.revoked.has(credential.Value)) return Promise.resolve(MUX.Caller.Invalid)
    return Promise.resolve(MUX.Caller.Authenticated(credential.Value, 'test', {}, this.expires?.()))
  }
}

const whoAmI: Horizon.Resolver<WhoAmI> = {
  Resolve: (q) => Promise.resolve({ status: q.From.Status, subject: q.From.Subject }),
}

function horizonServer() {
  const resolvers = new Horizon.Resolvers().Use(WhoAmI, whoAmI)
  const handlers = new Horizon.Handlers()
    .Use(Rename, {
      Handle: (a: Rename) => {
        if (a.To === 'ada') return Promise.reject(new Taken('ada'))
        return Promise.resolve(a.To)
      },
    })
    .Use(Explode, { Handle: () => Promise.reject(new Error('the database password is hunter2')) })
  return new Horizon.Server(resolvers, handlers)
}

async function withHttp(
  test: (courier: HttpCourier, client: Horizon.Client, server: Horizon.Server) => Promise<void>,
) {
  const transport = new HttpTransport(new MUX.Authentication([new Sessions()]))
  const server = horizonServer()
  server.Use(transport)
  const http = Deno.serve({ port: 0, onListen: () => {} }, (req) => transport.Handle(req))
  try {
    const courier = new HttpCourier(`http://localhost:${http.addr.port}`)
    await test(courier, new Horizon.Client(courier, { timeout: 2_000 }), server)
  } finally {
    await http.shutdown()
  }
}

// --- Authentication ------------------------------------------------------------

Deno.test('authentication: the sender is who the configured mechanism verified, or why it could not', () =>
  withHttp(async (courier, client) => {
    assertEquals(await client.Ask(new WhoAmI()), { status: 'anonymous' })

    courier.Carry(new MUX.Credentials.Cookie('sid', 'ada'))
    assertEquals(await client.Ask(new WhoAmI()), { status: 'authenticated', subject: 'ada' })

    courier.Carry(new MUX.Credentials.Cookie('sid', 'bad'))
    assertEquals((await client.Ask(new WhoAmI())).status, 'invalid')

    courier.Carry(new MUX.Credentials.Cookie('sid', 'down'))
    assertEquals((await client.Ask(new WhoAmI())).status, 'unavailable')

    courier.Forget()
    assertEquals((await client.Ask(new WhoAmI())).status, 'anonymous')
  }))

Deno.test('authentication: a packet sent with its own credential presents that one, for relays', () =>
  withHttp(async (courier, client) => {
    courier.Carry(new MUX.Credentials.Cookie('sid', 'relay'))
    const relayed = new WhoAmI()
    relayed.PresentWith(new MUX.Credentials.Cookie('sid', 'ada'))
    assertEquals((await client.Ask(relayed)).subject, 'ada')
  }))

Deno.test('authentication: a credential never shows up in logs', () => {
  const credential = new MUX.Credentials.Authorization('Bearer', 'secret-token')
  assertEquals(JSON.stringify({ credential }), '{"credential":"[Authorization]"}')
  assertEquals(`${credential}`, '[Authorization]')
})

Deno.test('authentication: a refusal is reported with the credential it refused, and the call rejects', async () => {
  const guard = Deno.serve(
    { port: 0, onListen: () => {} },
    () => Response.json({ error: 'unauthenticated' }, { status: 401 }),
  )
  try {
    const courier = new HttpCourier(`http://localhost:${guard.addr.port}`)
    const client = new Horizon.Client(courier)
    const credential = new MUX.Credentials.Cookie('sid', 'expired')
    const refusals: (MUX.Credential | undefined)[] = []
    courier.OnCredentialRefused.Do((refused) => refusals.push(refused))

    courier.Carry(credential)
    const error = await assertRejects(() => client.Ask(new WhoAmI()), Horizon.Undelivered)
    assertInstanceOf(error.Returned, MUX.Unauthenticated)

    courier.Forget()
    await assertRejects(() => client.Ask(new WhoAmI()), Horizon.Undelivered)

    assertEquals(refusals, [credential, undefined])
  } finally {
    await guard.shutdown()
  }
})

// --- Faults -------------------------------------------------------------------

Deno.test('faults: an app fault comes back as itself, to the call and to OnFault', () =>
  withHttp(async (_, client) => {
    const seen: Horizon.Fault[] = []
    client.OnFault.Do((fault) => seen.push(fault))

    const error = await assertRejects(() => client.Issue(new Rename('ada')), Taken)
    assertEquals(error.Name, 'ada')
    assertEquals(error.message, 'ada is taken')

    const outcome = await client.Attempt(new Rename('ada'))
    assert(!outcome.ok)
    assertInstanceOf(outcome.fault, Taken)

    assertEquals(await client.Attempt(new Rename('grace')), { ok: true, value: 'grace' })
    assertEquals(seen.length, 2)
  }))

Deno.test('faults: a crash answers at once, with an incident id and nothing else', () =>
  withHttp(async (_, client, server) => {
    const crashes: [unknown, string][] = []
    server.OnCrashed.Do((_, error, incident) => crashes.push([error, incident]))

    const crashed = await assertRejects(() => client.Issue(new Explode()), Horizon.Crashed)
    assert(!crashed.message.includes('hunter2'))
    assertEquals(crashes.length, 1)
    assertEquals(crashes[0][1], crashed.Incident)
    assertInstanceOf(crashes[0][0], Error)
  }))

Deno.test('faults: what no one resolves is Unhandled', () =>
  withHttp(async (_, client) => {
    await assertRejects(() => client.Ask(new Unknown()), Horizon.Unhandled)
  }))

Deno.test('faults: a resolver relaying a refusal sends it back as the same Returned', async () => {
  const transport = new HttpTransport()
  const resolvers = new Horizon.Resolvers().Use(WhoAmI, {
    Resolve: (q: WhoAmI) => Promise.reject(new Horizon.Undelivered(new MUX.Forbidden(q))),
  })
  new Horizon.Server(resolvers, new Horizon.Handlers()).Use(transport)
  const http = Deno.serve({ port: 0, onListen: () => {} }, (req) => transport.Handle(req))
  try {
    const client = new Horizon.Client(new HttpCourier(`http://localhost:${http.addr.port}`))
    const error = await assertRejects(() => client.Ask(new WhoAmI()), Horizon.Undelivered)
    assertInstanceOf(error.Returned, MUX.Forbidden)
  } finally {
    await http.shutdown()
  }
})

// --- WebSocket -----------------------------------------------------------------

async function withWs(
  options: MUX.Mechanism[],
  test: (open: () => Promise<[WsCourier, Horizon.Client]>) => Promise<void>,
  reverifyEveryMs?: number,
) {
  const transport = new WsTransport({ authentication: new MUX.Authentication(options), reverifyEveryMs })
  horizonServer().Use(transport)
  const http = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    const upgrade = new MUX.Envelope(req.headers)
    const { socket, response } = Deno.upgradeWebSocket(req)
    transport.Attach(socket, upgrade)
    return response
  })
  const couriers: WsCourier[] = []
  const open = async (): Promise<[WsCourier, Horizon.Client]> => {
    const courier = new WsCourier(`ws://localhost:${http.addr.port}`)
    couriers.push(courier)
    await new Promise<void>((resolve) => courier.OnConnect.DoOnce(() => resolve()))
    return [courier, new Horizon.Client(courier, { timeout: 2_000 })]
  }
  try {
    await test(open)
  } finally {
    for (const courier of couriers) courier.Close()
    transport.Close()
    await http.shutdown()
  }
}

Deno.test('websocket: a connection is authenticated in-band, on every Carry and Forget', () =>
  withWs([new Sessions()], async (open) => {
    const [courier, client] = await open()
    assertEquals((await client.Ask(new WhoAmI())).status, 'anonymous')

    courier.Carry(new MUX.Credentials.Cookie('sid', 'ada'))
    assertEquals((await client.Ask(new WhoAmI())).subject, 'ada')

    courier.Forget()
    assertEquals((await client.Ask(new WhoAmI())).status, 'anonymous')
  }))

Deno.test('websocket: an answer goes back to the connection that asked, not to everyone', () =>
  withWs([new Sessions()], async (open) => {
    const [ada, adaClient] = await open()
    const [, otherClient] = await open()
    ada.Carry(new MUX.Credentials.Cookie('sid', 'ada'))

    const overheard: unknown[] = []
    otherClient.Listen(WhoAmI, (q) => overheard.push(q.Result))

    assertEquals((await adaClient.Ask(new WhoAmI())).subject, 'ada')
    assertEquals(overheard, [])
  }))

Deno.test('websocket: a connection whose session was revoked is told so, without asking', async () => {
  const sessions = new Sessions(() => new Date(Date.now() + 100))
  await withWs([sessions], async (open) => {
    const [courier, client] = await open()
    const credential = new MUX.Credentials.Cookie('sid', 'ada')
    courier.Carry(credential)
    assertEquals((await client.Ask(new WhoAmI())).subject, 'ada')

    const refused = new Promise<MUX.Credential | undefined>((resolve) =>
      courier.OnCredentialRefused.DoOnce((c) => resolve(c))
    )
    sessions.Revoke('ada')
    assertEquals(await refused, credential)
  })
})

// --- Wire format -----------------------------------------------------------------

class Nothing extends Horizon.Query<null> {}
MUX.Packet.Register(Nothing, '/test.nothing')

/** What a reader without the packet classes sees — a guard, say. */
function onTheWire(packet: MUX.Packet): Record<string, any> {
  const sheet = Storage.Json.Empty()
  MUX.Packet.Registry.Dump(sheet, packet)
  return JSON.parse(sheet.Serialized)
}

Deno.test('wire: an answer and a fault are nested JSON, addressable by a JSON pointer', () => {
  const answered = new WhoAmI()
  answered.Wrap({ status: 'authenticated', subject: 'ada' })
  assertEquals(onTheWire(answered).data['query.result'].value.subject, 'ada')

  const failed = new Rename('ada')
  failed.Fail(new Taken('ada'))
  const fault = onTheWire(failed).data['horizon.fault']
  assertEquals(fault.type, '/horizon.fault/test.taken')
  assertEquals(fault.data['fault.taken.name'], 'ada')
})

Deno.test('wire: answering null is not the same as not answering', () =>
  withHttp(async (_, client, server) => {
    void server
    const unanswered = new Nothing()
    assertEquals(unanswered.Result, undefined)
    assertEquals(onTheWire(unanswered).data['query.result'], {})

    const transport = new HttpTransport()
    new Horizon.Server(
      new Horizon.Resolvers().Use(Nothing, { Resolve: () => Promise.resolve(null) }),
      new Horizon.Handlers(),
    ).Use(transport)
    const http = Deno.serve({ port: 0, onListen: () => {} }, (req) => transport.Handle(req))
    try {
      const nothing = new Horizon.Client(new HttpCourier(`http://localhost:${http.addr.port}`))
      assertEquals(await nothing.Ask(new Nothing()), null)
    } finally {
      await http.shutdown()
    }
    void client
  }))

Deno.test('wire: an answer handed back in-process is plain data, as it would be over the wire', () => {
  const q = new Horizon.Query<{ at: string }>()
  q.Wrap({ at: new Date(0) as unknown as string })
  assertEquals(q.Result, { at: '1970-01-01T00:00:00.000Z' })
})

// --- Secrets ---------------------------------------------------------------------

class SetPassword extends Horizon.Action<undefined> {
  private readonly user = this.c.String('', 'action.set_password.user')
  private readonly password = this.secret.String('', 'action.set_password.password')

  constructor(user = '', password = '') {
    super()
    this.user.Write(user)
    this.password.Write(password)
  }

  get Password(): string {
    return this.password.Read()
  }
}
MUX.Packet.Register(SetPassword, '/test.set_password')

Deno.test('secrets: a secret field travels, but never shows when written out for a person or a log', () => {
  const sent = new SetPassword('ada', 'hunter2')
  const received = MUX.Packet.Load(JSON.stringify(onTheWire(sent))) as SetPassword
  assertEquals(received.Password, 'hunter2')

  for (const shown of [JSON.stringify(sent), Deno.inspect(sent), JSON.stringify(new MUX.Forbidden(sent))]) {
    assert(!shown.includes('hunter2'), shown)
    assert(shown.includes('ada'), shown)
  }
  assert(!Deno.inspect(MUX.Presentation.Of(new MUX.Credentials.Cookie('sid', 'token'))).includes('token'))
})
