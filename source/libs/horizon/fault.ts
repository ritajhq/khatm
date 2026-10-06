import * as MUX from '@ritaj/mux'
import * as Storage from '@ritaj/storage'

type Constructor<T> = new (...args: any[]) => T

/**
 * Why a query or command wasn't answered. Apps define their own — the
 * outcomes a caller should act on, such as a plan that went stale — by
 * extending it and registering it by name; horizon defines the ones about
 * the protocol itself (`Unhandled`, `Crashed`, `TimedOut`, `Undelivered`).
 *
 * A fault is thrown like any error. Thrown by a resolver or handler, it
 * travels back with the answer and is thrown again on the client as the same
 * class, with the same fields — so both sides share one vocabulary, and the
 * caller reacts with `instanceof`.
 *
 * A subclass must be constructible without arguments (the registry restores
 * it that way), and keeps its fields in the codec, like a packet does — under
 * names `Error` doesn't already use (`name`, `message`, `stack`, `cause`).
 */
export class Fault extends Error implements Storage.Storable {
  protected readonly c = new Storage.Codec()
  /** Declares fields that travel but are never shown in logs: see MUX.Secrets. */
  protected readonly secret = new MUX.Secrets(this.c)
  private readonly text = this.c.String('', 'fault.message')

  static readonly Registry = new Storage.Registry<Fault>(new Map([[Fault, '/horizon.fault']]))

  constructor(message = '') {
    super(message)
    this.name = new.target.name
    this.text.Write(message)
  }

  static Register(c: Constructor<Fault>, t: string) {
    const self = Fault.Registry.ReadConstructor(this)
    Fault.Registry.Register(c, self + t)
    return Fault.Registry
  }

  /** Whether this fault can travel to the other side: only registered faults are restored there as themselves. */
  get IsRegistered(): boolean {
    try {
      Fault.Registry.Read(this)
      return true
    } catch {
      return false
    }
  }

  get Serialized(): string {
    const sheet = Storage.Json.Empty()
    Fault.Registry.Dump(sheet, this)
    return sheet.Serialized
  }

  static Load(serialized: string): Fault {
    return Fault.Registry.Restore(Storage.Json.Parse(serialized))
  }

  /** The fault as a person or a log may see it, secret fields hidden. What `JSON.stringify` shows. */
  toJSON(): { type: string; data: Record<string, unknown> } {
    return { type: this.IsRegistered ? Fault.Registry.Read(this) : this.name, data: this.secret.Disclose() }
  }

  /** What `console.log` shows: where it was thrown, then its fields, secret ones hidden. */
  [Symbol.for('Deno.customInspect')](): string {
    return `${this.stack}\n${JSON.stringify(this.toJSON().data)}`
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `${this.stack}\n${JSON.stringify(this.toJSON().data)}`
  }

  Dump = (storage: Storage.SerialStorage): void => {
    this.c.Dump(storage)
  }

  Restore = (storage: Storage.SerialStorage): void => {
    this.c.Restore(storage)
    this.message = this.text.Read()
  }
}

/** The receiving side has no resolver or handler for what it was sent. */
export class Unhandled extends Fault {}

/**
 * A resolver or handler failed with something that isn't a fault. Only
 * `Incident` crosses over — what went wrong stays with the receiving side
 * (see `Server.OnCrashed`), under the same id, so the two can be matched up
 * without leaking it.
 */
export class Crashed extends Fault {
  private readonly incident = this.c.String('', 'fault.crashed.incident')

  constructor(incident = '') {
    super('The receiving side failed while processing the message')
    this.incident.Write(incident)
  }

  get Incident(): string {
    return this.incident.Read()
  }
}

/** No answer came back in time. */
export class TimedOut extends Fault {}

/**
 * The transport handed the packet back undelivered; `Returned` says why —
 * tell reasons apart with `instanceof` (`MUX.Forbidden`,
 * `MUX.Unauthenticated`, …). Thrown by a resolver relaying to another
 * service, the receiving side sends that `Returned` back as it is.
 */
export class Undelivered extends Fault {
  constructor(readonly Returned: MUX.Returned) {
    super(`${Returned.constructor.name}: the packet was returned undelivered`)
  }
}

Fault.Register(Unhandled, '/unhandled')
Fault.Register(Crashed, '/crashed')
Fault.Register(TimedOut, '/timed_out')

/** The faults any query or command may end with, whatever it declares. */
export type ProtocolFault = Unhandled | Crashed | TimedOut | Undelivered
