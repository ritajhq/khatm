import type { Credential } from './credential.ts'
import { Envelope } from './envelope.ts'
import { Packet } from './packet.ts'

/**
 * A credential presented, or withdrawn, in-band — for a transport whose
 * envelope is only sent once, when it connects (a WebSocket's upgrade), and
 * which a browser can't put most credentials in anyway. The receiving side
 * authenticates the whole connection again from it; it is the transport's
 * own control message, never handed on to the app.
 *
 * It is the one packet that serializes a credential, so it is only ever sent
 * over the connection it presents it to.
 */
export class Presentation extends Packet {
  private readonly fields = this.secret.Record<Record<string, string>>({}, 'mux.presentation.fields')

  /** Presents `credential`; with none, withdraws whatever was presented before. */
  static Of(credential: Credential | undefined): Presentation {
    const presentation = new Presentation()
    const envelope = new Envelope()
    credential?.PresentIn(envelope)
    presentation.fields.Write(envelope.Fields)
    return presentation
  }

  /** What was presented, to authenticate from like any other envelope. */
  get Envelope(): Envelope {
    return new Envelope(this.fields.Read())
  }
}

Packet.Register(Presentation, '/mux.presentation')
