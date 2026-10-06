import { Caller } from '../caller'
import { Duplex, Packet } from '../packet'

import * as Storage from '@ritaj/storage'

type PromiseResolve = (value: Response | PromiseLike<Response>) => void
type PromiseReject = (reason?: any) => void

const DEFAULT_TIMEOUT_MS = 10000

export type HandleOptions = {
  caller?: Caller
  timeoutMs?: number
}

interface Deferred {
  resolve: PromiseResolve
  reject: PromiseReject
  timer?: number
}

export class Server extends Duplex {
  private resolvers = new WeakMap<Packet, Deferred>()

  constructor() {
    super()

    this.OnSending.Do(this.SendResponse)
  }

  /**
   * Accepts the packet `req` carries, attributed to `caller` — who sent it,
   * as whatever put this request in front of the server could tell (HTTP
   * itself can't) — and answers with the response packet.
   */
  async Handle(
    req: Request,
    { caller = Caller.Anonymous, timeoutMs = DEFAULT_TIMEOUT_MS }: HandleOptions = {},
  ): Promise<Response> {
    const serialized = await req.text()
    const packet = Packet.Load(serialized)

    packet.Attribute(caller)
    this.Accept(packet)

    return new Promise<Response>((resolve, reject) => {
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
  }

  // Cancel(packet: Packet, reason?: string): boolean {
  //   const def = this.resolvers.get(packet)

  //   if (!def) return false

  //   if (def.timer) {
  //     clearTimeout(def.timer)
  //   }

  //   def.reject(new Error(reason ?? 'cancelled'))
  //   this.resolvers.delete(packet)

  //   return true
  // }

  // Arrow field so it stays bound when handed to `OnSending.Do`, matching how
  // Duplex.Accept/Send bind themselves.
  private SendResponse = (p: Packet): void => {
    const def = this.resolvers.get(p)

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
    this.resolvers.delete(p)
  }
}
