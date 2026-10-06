import { Duplex, Packet } from '../packet'

import * as Storage from '@ritaj/storage'
import * as Event from '@ritaj/event'

export interface Socket {
  readonly readyState: number
  send(data: string): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  addEventListener(type: 'pong', listener: () => void): void
  ping?(): void
  terminate?(): void
}

const OPEN = 1
const PING_INTERVAL_MS = 30_000

export class Server extends Duplex {
  readonly OnConnect = new Event.Delegate<[Socket]>()
  readonly OnDisconnect = new Event.Delegate<[Socket]>()

  private readonly connections = new Set<Socket>()
  private readonly alive = new WeakMap<Socket, boolean>()

  constructor() {
    super()

    this.OnSending.Do(this.Broadcast)
    this.startHeartbeat()
  }

  Attach(socket: Socket): void {
    this.connections.add(socket)
    this.alive.set(socket, true)

    socket.addEventListener('pong', () => {
      this.alive.set(socket, true)
    })

    socket.addEventListener('message', (e: { data: unknown }) => {
      const data = typeof e.data === 'string' ? e.data : String(e.data)
      this.Accept(Packet.Load(data))
    })

    socket.addEventListener('close', () => {
      this.connections.delete(socket)
      this.OnDisconnect.Invoke(socket)
    })

    this.OnConnect.Invoke(socket)
  }

  private startHeartbeat(): void {
    setInterval(() => {
      for (const socket of this.connections) {
        if (socket.readyState !== OPEN) continue

        if (!this.alive.get(socket)) {
          socket.terminate?.()
          continue
        }

        this.alive.set(socket, false)
        socket.ping?.()
      }
    }, PING_INTERVAL_MS)
  }

  private Broadcast = (p: Packet): void => {
    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, p)
    const serialized = sheet.Serialized

    for (const socket of this.connections) {
      if (socket.readyState === OPEN) socket.send(serialized)
    }
  }
}
