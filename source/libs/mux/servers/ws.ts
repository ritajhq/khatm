import { Attribution, Authentication } from '../authentication.ts'
import { Envelope } from '../envelope.ts'
import { Duplex, Packet } from '../packet.ts'
import { Presentation } from '../presentation.ts'
import { Returned, Unauthenticated } from '../returned.ts'

import * as Storage from '@ritaj/storage'
import * as Event from '@ritaj/event'

export interface Socket {
  readonly readyState: number
  send(data: string): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  addEventListener(type: 'pong', listener: () => void): void
  ping?(): void
  terminate?(): void
}

export type ServerOptions = {
  /** Attributes each connection to its sender; with none configured, every sender is anonymous. */
  authentication?: Authentication
  /**
   * How long a connection's identity is trusted before its credential is
   * verified again, for mechanisms that can't tell when it expires. A caller
   * with an expiry is verified again once it passes, whatever this says.
   */
  reverifyEveryMs?: number
}

const OPEN = 1
const PING_INTERVAL_MS = 30_000
const REVERIFY_CHECK_MS = 5_000

/**
 * One socket and who is on it. A connection presents its credential once —
 * in its upgrade request, then in-band with `Presentation`s — so the identity
 * that attributes its packets is kept here, and verified again when it may
 * have stopped holding.
 */
class Connection {
  private attribution = Attribution.Anonymous
  private verifiedAt = 0
  // Each packet waits for the ones before it, so a presentation always
  // attributes the packets sent after it, never the ones before.
  private queue: Promise<void> = Promise.resolve()

  constructor(
    readonly Socket: Socket,
    private envelope: Envelope,
    private readonly authentication: Authentication,
  ) {}

  /** Runs `step` after everything this connection received before it. */
  Then(step: () => Promise<void> | void): void {
    this.queue = this.queue.then(step).catch((error) => {
      console.error('[mux/ws] failed to handle an incoming packet', error)
    })
  }

  /** Authenticates the connection again, from `envelope` when it presented a new one. */
  async Authenticate(envelope?: Envelope): Promise<void> {
    if (envelope) this.envelope = envelope
    this.attribution = await this.authentication.Authenticate(this.envelope)
    this.verifiedAt = Date.now()
  }

  IsDue(now: Date, reverifyEveryMs: number | undefined): boolean {
    if (this.attribution.Caller.IsExpiredAt(now)) return true
    return reverifyEveryMs !== undefined && now.getTime() - this.verifiedAt >= reverifyEveryMs
  }

  get IsAuthenticated(): boolean {
    return this.attribution.Caller.IsAuthenticated
  }

  Attribute(packet: Packet): void {
    packet.Attribute(this.attribution)
  }
}

export class Server extends Duplex {
  readonly OnConnect = new Event.Delegate<[Socket]>()
  readonly OnDisconnect = new Event.Delegate<[Socket]>()

  private readonly connections = new Map<Socket, Connection>()
  private readonly alive = new WeakMap<Socket, boolean>()
  // Which connection each received packet came from, so its answer goes back there alone.
  private readonly origins = new WeakMap<Packet, Connection>()
  private readonly authentication: Authentication
  private readonly reverifyEveryMs: number | undefined
  private readonly timers: ReturnType<typeof setInterval>[]

  constructor({ authentication = Authentication.None, reverifyEveryMs }: ServerOptions = {}) {
    super()

    this.authentication = authentication
    this.reverifyEveryMs = reverifyEveryMs
    this.OnSending.Do(this.Route)
    this.timers = [
      setInterval(this.Heartbeat, PING_INTERVAL_MS),
      setInterval(this.Reverify, REVERIFY_CHECK_MS),
    ]
  }

  /**
   * Takes on `socket`, authenticated from `upgrade` — the envelope of the
   * request that opened it. Take it before upgrading: Deno closes the
   * request's headers once `Deno.upgradeWebSocket` has run.
   */
  Attach(socket: Socket, upgrade: Envelope = new Envelope()): void {
    const connection = new Connection(socket, upgrade, this.authentication)
    this.connections.set(socket, connection)
    this.alive.set(socket, true)
    connection.Then(() => connection.Authenticate())

    socket.addEventListener('pong', () => {
      this.alive.set(socket, true)
    })

    socket.addEventListener('message', (e: { data: unknown }) => {
      const data = typeof e.data === 'string' ? e.data : String(e.data)
      connection.Then(() => this.Receive(connection, Packet.Load(data)))
    })

    socket.addEventListener('close', () => {
      this.connections.delete(socket)
      this.OnDisconnect.Invoke(socket)
    })

    this.OnConnect.Invoke(socket)
  }

  /** Stops the heartbeat and reverification; the sockets themselves are their owner's to close. */
  Close(): void {
    for (const timer of this.timers) clearInterval(timer)
  }

  private async Receive(connection: Connection, packet: Packet): Promise<void> {
    if (packet instanceof Presentation) {
      await connection.Authenticate(packet.Envelope)
      return
    }

    if (connection.IsDue(new Date(), this.reverifyEveryMs)) {
      await connection.Authenticate()
    }

    connection.Attribute(packet)
    this.origins.set(packet, connection)
    this.Accept(packet)
  }

  private Heartbeat = (): void => {
    for (const socket of this.connections.keys()) {
      if (socket.readyState !== OPEN) continue

      if (!this.alive.get(socket)) {
        socket.terminate?.()
        continue
      }

      this.alive.set(socket, false)
      socket.ping?.()
    }
  }

  /**
   * Verifies again every connection whose identity may have stopped holding,
   * and tells the ones it no longer does — without waiting for them to send
   * something — so their app can renew the credential or sign in again.
   */
  private Reverify = (): void => {
    const now = new Date()
    for (const connection of this.connections.values()) {
      if (!connection.IsDue(now, this.reverifyEveryMs)) continue

      connection.Then(async () => {
        const was = connection.IsAuthenticated
        await connection.Authenticate()
        if (was && !connection.IsAuthenticated) {
          this.SendTo(connection.Socket, new Unauthenticated(Presentation.Of(undefined)))
        }
      })
    }
  }

  /** An answer goes back to the connection its packet came from; anything else the server sends goes to every connection. */
  private Route = (p: Packet): void => {
    const origin = this.origins.get(p instanceof Returned ? p.Packet : p)

    if (origin) {
      this.SendTo(origin.Socket, p)
      return
    }

    for (const socket of this.connections.keys()) this.SendTo(socket, p)
  }

  private SendTo(socket: Socket, p: Packet): void {
    if (socket.readyState !== OPEN) return

    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, p)
    socket.send(sheet.Serialized)
  }
}
