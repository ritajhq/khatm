import { Caller } from './caller.ts'
import type { Credential } from './credential.ts'
import type { Envelope } from './envelope.ts'

/**
 * One way of authenticating, chosen by the app (and provided by whatever
 * issues its credentials): where its credential is in an envelope, and
 * whether it proves an identity. It reports, never refuses — a missing
 * credential is for `Extract` to leave undefined, a bad one for `Verify` to
 * call `Caller.Invalid`.
 */
export interface Mechanism<C extends Credential = Credential> {
  Extract(envelope: Envelope): C | undefined
  Verify(credential: C): Promise<Caller>
}

/** Who sent what arrived, and the credential that showed it. */
export class Attribution {
  static readonly Anonymous = new Attribution(Caller.Anonymous)

  constructor(readonly Caller: Caller, readonly Credential?: Credential) {}
}

/**
 * The receiving side's steps, the same for every mechanism and transport:
 * extract the credential with the configured mechanisms, verify it, and
 * attribute what that proved. The first mechanism that finds its credential
 * decides; with none configured, or none found, the sender is anonymous.
 */
export class Authentication {
  static readonly None = new Authentication([])

  // deno-lint-ignore no-explicit-any
  constructor(private readonly mechanisms: readonly Mechanism<any>[]) {}

  async Authenticate(envelope: Envelope): Promise<Attribution> {
    for (const mechanism of this.mechanisms) {
      const credential = mechanism.Extract(envelope)
      if (credential === undefined) continue

      return new Attribution(await this.Verify(mechanism, credential), credential)
    }
    return Attribution.Anonymous
  }

  /** A mechanism that can't verify — its identity provider is down, say — leaves the caller unavailable rather than failing the packet. */
  private async Verify(mechanism: Mechanism, credential: Credential): Promise<Caller> {
    try {
      return await mechanism.Verify(credential)
    } catch {
      return Caller.Unavailable
    }
  }
}
