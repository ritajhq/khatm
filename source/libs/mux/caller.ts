/**
 * Who sent a packet, as the transport that received it could tell — never
 * what the packet claims about itself. A transport that can't tell leaves
 * every packet anonymous.
 *
 * It travels next to the packet, never inside it: it isn't serialized, so it
 * can't be forged over the wire, and a packet relayed onward is attributed
 * by whoever receives it next, not by this hop.
 */
export class Caller {
  static readonly Anonymous = new Caller(undefined, undefined, Object.freeze({}))

  private constructor(
    readonly Subject: string | undefined,
    readonly Issuer: string | undefined,
    readonly Claims: Readonly<Record<string, unknown>>,
  ) {}

  static Authenticated(subject: string, issuer: string, claims: Record<string, unknown> = {}): Caller {
    return new Caller(subject, issuer, Object.freeze({ ...claims }))
  }

  get IsAuthenticated(): boolean {
    return this.Subject !== undefined
  }
}
