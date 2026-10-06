import { Duplex, Packet } from '../packet'
import { Failed, Forbidden, Returned, Unauthenticated, Unavailable, Unreachable } from '../returned'

import * as Storage from '@ritaj/storage'

/** How the HTTP answer to an undelivered packet is stamped when it is returned; any other failing status is `Failed`. */
const RETURNED_FOR_STATUS: Readonly<Record<number, new (packet: Packet) => Returned>> = {
  401: Unauthenticated,
  403: Forbidden,
  502: Unreachable,
  503: Unavailable,
  504: Unavailable,
}

export class Client extends Duplex {
  constructor(readonly endpoint: string) {
    super()

    this.OnSending.Do(this.SendRequest)
  }

  // `OnSending.Do` dispatches to this callback fire-and-forget (Delegate.Invoke
  // never awaits/catches its subscribers), so a rejected fetch() here would
  // otherwise become an unhandled promise rejection — fatal to a Node process,
  // not just a dropped request. Every failure (network error or a non-OK
  // response) must come back as a `Returned` packet instead of
  // throwing/rejecting past this function.
  private SendRequest = async (p: Packet): Promise<void> => {
    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, p)

    // The URL names only the packet's own leaf (`/profile.get`), not its
    // whole registry path (`/mux.packet/horizon.query/profile.get`): the
    // server dispatches on the body's `type`, and the leaf is what an
    // authorization manifest matches the request on.
    const name = Packet.Registry.Read(p).split('/').pop()

    const url = `${this.endpoint}/${name}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sheet.Serialized,
    }).catch(() => null)

    if (response === null) {
      this.Accept(new Unreachable(p))
      return
    }

    if (!response.ok) {
      const returned = RETURNED_FOR_STATUS[response.status] ?? Failed
      this.Accept(new returned(p))
      return
    }

    const payload = await response.text().then((text) => Packet.Load(text)).catch(() => null)

    this.Accept(payload ?? new Failed(p))
  }
}
