import { Authentication } from '../authentication.ts'
import { Envelope } from '../envelope.ts'
import { Duplex, Packet } from '../packet.ts'
import { Returned } from '../returned.ts'

import * as Storage from '@ritaj/storage'

type PromiseResolve = (value: Response | PromiseLike<Response>) => void
type PromiseReject = (reason?: any) => void

const DEFAULT_TIMEOUT_MS = 10000

export type HandleOptions = {
  timeoutMs?: number
}

interface Deferred {
  resolve: PromiseResolve
  reject: PromiseReject
  timer?: number
}

export class Server extends Duplex {
  private resolvers = new WeakMap<Packet, Deferred>()

  /** `authentication` attributes each request's packet to its sender; with none configured, every sender is anonymous. */
  constructor(private readonly authentication: Authentication = Authentication.None) {
    super()

    this.OnSending.Do(this.SendResponse)
  }

  /**
   * Accepts the packet `req` carries, attributed to whoever the configured
   * authentication says sent it, and answers with the response packet.
   */
  async Handle(
    req: Request,
    { timeoutMs = DEFAULT_TIMEOUT_MS }: HandleOptions = {},
  ): Promise<Response> {
    const packet = await req.text().then((text) => Packet.Load(text)).catch(() => null)

    if (packet === null) {
      return Response.json({ error: 'not a packet' }, { status: 400 })
    }

    // A guard in front decides on the URL, which names the packet (see the
    // HTTP client): one whose body is another packet would get past it as
    // something it is not.
    if (new URL(req.url).pathname.split('/').pop() !== Packet.Registry.Read(packet).split('/').pop()) {
      return Response.json({ error: 'the packet is not the one the URL names' }, { status: 400 })
    }

    packet.Attribute(await this.authentication.Authenticate(new Envelope(req.headers)))

    const answered = new Promise<Response>((resolve, reject) => {
      const def: Deferred = { resolve, reject }

      // Install timeout to avoid leaked resolvers
      def.timer = (globalThis.setTimeout(() => {
        // timeout -> respond with 504 Gateway Timeout
        const body = JSON.stringify({ error: 'timeout' })
        const resp = new Response(body, {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        })

        // resolve with timeout response and clean up
        try {
          def.resolve(resp)
        } finally {
          this.resolvers.delete(packet)
        }
      }, timeoutMs) as unknown) as number

      this.resolvers.set(packet, def)
    })

    this.Accept(packet)

    return answered
  }

  // Arrow field so it stays bound when handed to `OnSending.Do`, matching how
  // Duplex.Accept/Send bind themselves.
  private SendResponse = (p: Packet): void => {
    // A packet sent back undelivered answers the request that carried it.
    const answered = p instanceof Returned ? p.Packet : p
    const def = this.resolvers.get(answered)

    if (!def) {
      // No resolver found for this packet — fail-safe: ignore instead of throwing
      return
    }

    if (def.timer) {
      clearTimeout(def.timer)
    }

    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, p)

    const response = new Response(sheet.Serialized, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    def.resolve(response)
    this.resolvers.delete(answered)
  }
}
