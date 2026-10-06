/**
 * What authentication found out about a packet's sender: a verified
 * identity, no credential at all, a credential that failed verification, or
 * a credential that could not be checked because whatever verifies it was
 * unreachable.
 */
export type CallerStatus = 'authenticated' | 'anonymous' | 'invalid' | 'unavailable'

/**
 * Who sent a packet, as the transport that received it could tell — never
 * what the packet claims about itself. A transport with no authentication
 * configured leaves every packet anonymous.
 *
 * It is only reported, never enforced: whether a caller may do something is
 * for whatever authorizes it to decide, not for the communication layer.
 *
 * It travels next to the packet, never inside it: it isn't serialized, so it
 * can't be forged over the wire, and a packet relayed onward is attributed
 * by whoever receives it next, not by this hop.
 */
export class Caller {
  static readonly Anonymous = new Caller('anonymous', undefined, undefined, Object.freeze({}))
  static readonly Invalid = new Caller('invalid', undefined, undefined, Object.freeze({}))
  static readonly Unavailable = new Caller('unavailable', undefined, undefined, Object.freeze({}))

  private constructor(
    readonly Status: CallerStatus,
    readonly Subject: string | undefined,
    readonly Issuer: string | undefined,
    readonly Claims: Readonly<Record<string, unknown>>,
    /** When the credential that proved this identity stops proving it, when its mechanism knows. */
    readonly Expires?: Date,
  ) {}

  static Authenticated(
    subject: string,
    issuer: string,
    claims: Record<string, unknown> = {},
    expires?: Date,
  ): Caller {
    return new Caller('authenticated', subject, issuer, Object.freeze({ ...claims }), expires)
  }

  get IsAuthenticated(): boolean {
    return this.Status === 'authenticated'
  }

  /** Whether the identity can no longer be trusted at `now` without verifying its credential again. */
  IsExpiredAt(now: Date): boolean {
    return this.Expires !== undefined && this.Expires.getTime() <= now.getTime()
  }
}
