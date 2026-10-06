import { Credential } from './credential.ts'
import type { Envelope } from './envelope.ts'

/**
 * A credential carried in a cookie, such as a server-side session.
 *
 * A browser won't let a page set the `Cookie` header itself: there the
 * browser presents its own cookies, and an app carries no `Cookie` at all.
 * Elsewhere (a server relaying a caller's session) it is presented as given.
 */
export class Cookie extends Credential {
  constructor(readonly Name: string, readonly Value: string) {
    super()
  }

  PresentIn(envelope: Envelope): void {
    envelope.SetCookie(this.Name, this.Value)
  }
}

/** A credential carried as `Authorization: <scheme> <value>`, such as an OAuth access token (`Bearer`). */
export class Authorization extends Credential {
  constructor(readonly Scheme: string, readonly Value: string) {
    super()
  }

  PresentIn(envelope: Envelope): void {
    envelope.SetHeader('authorization', `${this.Scheme} ${this.Value}`)
  }
}

/** A credential carried in a header of its own, or a set of them, such as the identity a proxy in front forwards. */
export class Headers extends Credential {
  constructor(readonly Fields: Readonly<Record<string, string>>) {
    super()
  }

  PresentIn(envelope: Envelope): void {
    for (const [name, value] of Object.entries(this.Fields)) envelope.SetHeader(name, value)
  }
}
