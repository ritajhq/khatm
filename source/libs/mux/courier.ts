import * as Event from '@ritaj/event'

import type { Credential } from './credential.ts'
import { Envelope } from './envelope.ts'
import { Duplex, type Packet } from './packet.ts'
import { Unauthenticated } from './returned.ts'

/**
 * The sending side of a transport: it carries packets out, and with them the
 * credential the app gave it. The app acquires, renews and discards
 * credentials; a courier only presents what it was handed, and reports when
 * the receiving side refused it — what to do then (renew, sign in again) is
 * the app's to decide.
 */
export class Courier extends Duplex {
  private carried: Credential | undefined
  private readonly refused = new Event.Delegate<[credential: Credential | undefined, returned: Unauthenticated]>()

  constructor() {
    super()

    this.OnReceving.Do(this.WatchRefusals)
  }

  /**
   * A packet came back `Unauthenticated`: the credential it was sent with —
   * `undefined` when it was sent with none — wasn't taken. The app renews it
   * and `Carry`s the new one, or sends its user to sign in.
   */
  get OnCredentialRefused(): Event.Emitter<[credential: Credential | undefined, returned: Unauthenticated]> {
    return this.refused
  }

  /** Presents `credential` with every packet from now on. */
  Carry(credential: Credential): void {
    this.carried = credential
    this.Present(credential)
  }

  /** Stops presenting the credential carried so far — the app signed out. */
  Forget(): void {
    this.carried = undefined
    this.Present(undefined)
  }

  /**
   * For a transport that presents a credential once for many packets (a
   * connection) rather than with each one: present `credential` now, or
   * withdraw the one presented when it is undefined.
   */
  protected Present(_credential: Credential | undefined): void {}

  /** The credential carried right now, for a transport presenting it on its own schedule. */
  protected get Carried(): Credential | undefined {
    return this.carried
  }

  /** The envelope `packet` goes out in: its own credential when a relay gave it one, else the one carried. */
  protected EnvelopeFor(packet: Packet): Envelope {
    const envelope = new Envelope()
    ;(packet.Credential ?? this.carried)?.PresentIn(envelope)
    return envelope
  }

  private WatchRefusals = (packet: Packet): void => {
    if (!(packet instanceof Unauthenticated)) return

    this.refused.Invoke(packet.Packet.Credential ?? this.carried, packet)
  }
}
