import type { Envelope } from './envelope.ts'

/**
 * What a sender presents to prove who it is. Each kind knows where it
 * travels in an envelope; what makes one valid is for the mechanism that
 * verifies it to say.
 *
 * It is never serialized with a packet. It renders as its kind alone, so
 * logging a packet or a credential never writes the secret out.
 */
export abstract class Credential {
  abstract PresentIn(envelope: Envelope): void

  toJSON(): string {
    return `[${this.constructor.name}]`
  }

  toString(): string {
    return this.toJSON()
  }
}
