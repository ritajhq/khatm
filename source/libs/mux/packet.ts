import * as Storage from '@ritaj/storage'
import * as Event from '@ritaj/event'

import { Caller } from './caller'

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
  Dump = this.c.Dump
  Restore = this.c.Restore

  // Not codec-backed on purpose: see Caller.
  private from = Caller.Anonymous

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

  /** Attributes this packet to its sender — for the transport that received it, before it `Accept`s it. */
  Attribute(caller: Caller) {
    this.from = caller
  }

  SendWith(s: Sender) {
    s.Send(this)
  }

  static Load(serialized: string) {
    const sheet = Storage.Json.Parse(serialized)

    return this.Registry.Restore(sheet)
  }
}
