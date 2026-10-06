import { Courier } from '../courier.ts'
import type { Credential } from '../credential.ts'
import { Packet } from '../packet.ts'
import { Presentation } from '../presentation.ts'

import * as Storage from '@ritaj/storage'
import * as Event from '@ritaj/event'

const RECONNECT_DELAY_MS = 3_000

export class Client extends Courier {
  readonly OnError = new Event.Delegate<[error: unknown]>()
  readonly OnConnect = new Event.Delegate<[]>()
  readonly OnDisconnect = new Event.Delegate<[]>()

  private socket: WebSocket
  private pending: string[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true
  // What the app last asked to present; sent again on every (re)connection,
  // since the receiving side authenticates each connection afresh.
  private presentation: Presentation | undefined

  constructor(readonly url: string) {
    super()

    this.socket = this.createSocket()
    this.OnSending.Do(this.SendPacket)
  }

  Close(code?: number, reason?: string): void {
    this.shouldReconnect = false
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket.close(code, reason)
  }

  private createSocket(): WebSocket {
    const socket = new WebSocket(this.url)

    socket.addEventListener('open', () => {
      if (this.presentation) socket.send(this.Serialize(this.presentation))
      for (const msg of this.pending) socket.send(msg)
      this.pending = []
      this.OnConnect.Invoke()
    })

    socket.addEventListener('message', (e: MessageEvent) => {
      const data = typeof e.data === 'string' ? e.data : String(e.data)
      try {
        this.Accept(Packet.Load(data))
      } catch (err) {
        // Never the frame itself: it may carry a secret field.
        console.error('[mux/ws] failed to deserialize incoming packet', err)
      }
    })

    socket.addEventListener('error', e => this.OnError.Invoke(e))

    socket.addEventListener('close', () => {
      this.OnDisconnect.Invoke()
      this.scheduleReconnect()
    })

    return socket
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.socket = this.createSocket()
    }, RECONNECT_DELAY_MS)
  }

  /**
   * A connection presents its credential once, not with each packet: the
   * upgrade request carries whatever the browser adds itself (its cookies),
   * and anything the app carries is presented in-band.
   */
  protected override Present(credential: Credential | undefined): void {
    this.presentation = Presentation.Of(credential)
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(this.Serialize(this.presentation))
    }
  }

  private Serialize(p: Packet): string {
    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, p)
    return sheet.Serialized
  }

  private SendPacket = (p: Packet): void => {
    const serialized = this.Serialize(p)

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(serialized)
      return
    }

    if (this.socket.readyState === WebSocket.CONNECTING || this.reconnectTimer !== null) {
      this.pending.push(serialized)
      return
    }

    this.OnError.Invoke(new Error('socket closed'))
  }
}
