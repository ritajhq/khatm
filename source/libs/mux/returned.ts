import * as Storage from '@ritaj/storage'

import { Packet } from './packet.ts'

/**
 * A packet a transport could not deliver, handed back to whoever sent it —
 * like a letter returned to sender, stamped with the reason. It arrives the
 * way any answer does (a transport `Accept`s it), so the sender matches it to
 * what it sent the same way it matches an answer. Each reason is a subclass,
 * so telling them apart is `instanceof`, whatever transport stamped it.
 *
 * It is an ordinary packet: it serializes with the packet it carries, so a
 * service relaying packets across another protocol can pass it back upstream
 * as it is.
 */
export class Returned extends Packet {
  private readonly packet = this.c.String('', 'mux.returned.packet')
  private carried: Packet | undefined

  constructor(packet?: Packet) {
    super()
    if (packet === undefined) return

    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, packet)
    this.packet.Write(sheet.Serialized)
    this.carried = packet
  }

  /** The packet that could not be delivered. */
  get Packet(): Packet {
    this.carried ??= Packet.Load(this.packet.Read())
    return this.carried
  }

  /** Shows the packet it carries as that packet shows itself, secret fields hidden — never its serialized form. */
  override toJSON(): { type: string; data: Record<string, unknown> } {
    const { type } = super.toJSON()
    return { type, data: { packet: this.packet.Read() === '' ? undefined : this.Packet.toJSON() } }
  }
}

/** The receiving side would not take the packet from this sender. */
export class Refusal extends Returned {}

/** Refused because the sender is not known: signing in may change that. */
export class Unauthenticated extends Refusal {}

/** Refused because the sender, known, may not send this packet. */
export class Forbidden extends Refusal {}

/** The receiving side can't take the packet for now; sending it again later may work. */
export class Unavailable extends Returned {}

/** The receiving side could not be reached. */
export class Unreachable extends Returned {}

/** The receiving side took the packet, but failed at it. */
export class Failed extends Returned {}

Packet.Register(Returned, '/mux.returned')
Returned.Register(Refusal, '/refusal')
Refusal.Register(Unauthenticated, '/unauthenticated')
Refusal.Register(Forbidden, '/forbidden')
Returned.Register(Unavailable, '/unavailable')
Returned.Register(Unreachable, '/unreachable')
Returned.Register(Failed, '/failed')
