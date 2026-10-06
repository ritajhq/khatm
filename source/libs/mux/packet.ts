import * as Storage from '@ritaj/storage'
import * as Event from '@ritaj/event'

import type { Attribution } from './authentication.ts'
import { Caller } from './caller.ts'
import type { Credential } from './credential.ts'
import { INSPECT, Secrets } from './secrets.ts'

type Constructor<T = any> = new (...args: any[]) => T

export class Receiver {
  readonly OnReceving = new Event.Delegate<[Packet]>()

  Accept = this.OnReceving.Invoke.bind(this.OnReceving)
}

export class Sender {
  readonly OnSending = new Event.Delegate<[Packet]>()

  Send = this.OnSending.Invoke.bind(this.OnSending)
}

export class Duplex implements Receiver, Sender {
  readonly OnReceving = new Event.Delegate<[packet: Packet]>()
  readonly OnSending = new Event.Delegate<[packet: Packet]>()

  Accept = this.OnReceving.Invoke.bind(this.OnReceving)
  Send = this.OnSending.Invoke.bind(this.OnSending)
}

/**
 * Half-duplex signature is the same as a full-duplex, but it can't receive
 * and send at the same time.
 * 
 * @todo How to make it more distinct?
 */
export class HalfDuplex implements Receiver, Sender {
  readonly OnReceving = new Event.Delegate<[packet: Packet]>()
  readonly OnSending = new Event.Delegate<[packet: Packet]>()
  
  Accept = this.OnReceving.Invoke.bind(this.OnReceving)
  Send = this.OnSending.Invoke.bind(this.OnSending)
}

export class Packet implements Storage.Storable {
  protected readonly c = new Storage.Codec()
  /** Declares fields that travel but are never shown in logs: see Secrets. */
  protected readonly secret = new Secrets(this.c)
  Dump = this.c.Dump
  Restore = this.c.Restore

  // Not codec-backed on purpose: see Caller and Credential.
  private from = Caller.Anonymous
  private credential: Credential | undefined

  static readonly Registry = new Storage.Registry<Packet>(
    new Map([[Packet, '/mux.packet']]),
  )

  static Register(c: Constructor<Packet>, t: string) {
    const self = this.Registry.ReadConstructor(this)
    this.Registry.Register(c, self + t)
    return this.Registry
  }

  /** Who sent this packet, as the transport that received it could tell. */
  get From(): Caller {
    return this.from
  }

  /**
   * The credential this packet travels with: on a received packet, the one
   * its sender presented; on one being sent, the one `PresentWith` gave it.
   */
  get Credential(): Credential | undefined {
    return this.credential
  }

  /** Attributes this packet to its sender — for the transport that received it, before it `Accept`s it. */
  Attribute(attribution: Attribution) {
    this.from = attribution.Caller
    this.credential = attribution.Credential
  }

  /**
   * Sends this packet with `credential` instead of the one its transport
   * carries — for a relay acting on behalf of the sender of another packet:
   * `outgoing.PresentWith(incoming.Credential)`. Never done implicitly.
   */
  PresentWith(credential: Credential | undefined) {
    this.credential = credential
  }

  /**
   * The packet as a person or a log may see it: its type and fields, secret
   * ones hidden. Never who sent it or the credential it came with. What
   * `JSON.stringify` and `console.log` show.
   */
  toJSON(): { type: string; data: Record<string, unknown> } {
    return { type: TypeOf(this), data: this.secret.Disclose() }
  }

  [INSPECT[0]](): string {
    return JSON.stringify(this.toJSON())
  }

  [INSPECT[1]]() {
    return this.toJSON()
  }

  SendWith(s: Sender) {
    s.Send(this)
  }

  static Load(serialized: string) {
    const sheet = Storage.Json.Parse(serialized)

    return this.Registry.Restore(sheet)
  }
}

function TypeOf(packet: Packet): string {
  try {
    return Packet.Registry.Read(packet)
  } catch {
    return packet.constructor.name
  }
}
