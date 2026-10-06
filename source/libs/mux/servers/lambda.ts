import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'

import { HalfDuplex, Packet } from '../packet'

import * as Storage from '@ritaj/storage'
import * as Event from '@ritaj/event'

type PromiseResolve = (
  value: APIGatewayProxyResultV2 | PromiseLike<APIGatewayProxyResultV2>
) => void
type PromiseReject = (reason?: any) => void

const DEFAULT_TIMEOUT_MS = 10000

interface Deferred {
  resolve: PromiseResolve
  reject: PromiseReject
  timer?: number
}

export class Server extends HalfDuplex {
  private resolvers = new WeakMap<Packet, Deferred>()

  constructor() {
    super()

    this.OnSending.Do(this.SendResponse)
  }

  Handle(
    event: APIGatewayProxyEventV2,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<APIGatewayProxyResultV2> {
    const body = event.body ?? ''

    const serialized = event.isBase64Encoded
      ? Buffer.from(body, 'base64').toString('utf-8')
      : body

    const packet = Packet.Load(serialized)

    this.Accept(packet)

    return new Promise<APIGatewayProxyResultV2>((resolve, reject) => {
      const def: Deferred = { resolve, reject }

      def.timer = globalThis.setTimeout(() => {
        // timeout -> respond with 504 Gateway Timeout
        const resp: APIGatewayProxyResultV2 = {
          statusCode: 504,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'timeout' }),
        }

        try {
          def.resolve(resp)
        } catch (err) {
          console.error('Error resolving timeout response:', err)
        } finally {
          this.resolvers.delete(packet)
        }
      }, timeoutMs) as unknown as number

      this.resolvers.set(packet, def)
    })
  }

  @Event.Bound
  private SendResponse(p: Packet): void {
    const def = this.resolvers.get(p)

    if (!def) {
      // No resolver found for this packet — fail-safe: ignore instead of throwing
      return
    }

    if (def.timer) {
      clearTimeout(def.timer)
    }

    const sheet = Storage.Json.Empty()
    Packet.Registry.Dump(sheet, p)

    const response: APIGatewayProxyResultV2 = {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: sheet.Serialized,
    }

    def.resolve(response)
    this.resolvers.delete(p)
  }
}
