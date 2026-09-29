const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

/**
 * A reverse proxy whose upstream can be switched atomically. A request
 * belongs to the upstream that was current when it arrived, so switching
 * never cuts one off; `drain()` waits for the old upstream's requests to
 * finish before it is stopped.
 */
export class SwitchableProxy {
  private current: string | undefined
  private readonly inFlight = new Map<string, number>()
  private readonly waiters = new Map<string, Array<() => void>>()

  constructor(private readonly send: typeof fetch = fetch) {}

  /** The upstream new requests go to, as its origin. */
  get upstream(): string | undefined {
    return this.current
  }

  switchTo(upstream: string | undefined): void {
    this.current = upstream === undefined ? undefined : originOf(upstream)
  }

  inFlightTo(upstream: string): number {
    return this.inFlight.get(originOf(upstream)) ?? 0
  }

  /** Resolves when no request is in flight to `upstream`, or after `timeoutMs`. */
  drain(upstream: string, timeoutMs = 10_000): Promise<void> {
    const origin = originOf(upstream)
    if (this.inFlightTo(origin) === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      const list = this.waiters.get(origin) ?? []
      list.push(done)
      this.waiters.set(origin, list)
    })
  }

  async handle(request: Request): Promise<Response> {
    const upstream = this.current
    if (upstream === undefined) {
      return new Response('No upstream is serving', { status: 503 })
    }

    const source = new URL(request.url)
    const target = new URL(source.pathname + source.search, upstream)
    const headers = new Headers(request.headers)
    for (const name of HOP_BY_HOP) headers.delete(name)
    // Ask for the body as-is: fetch would decode it, leaving the encoding
    // and length headers describing bytes we no longer have.
    headers.set('accept-encoding', 'identity')
    headers.set('x-forwarded-host', source.host)
    headers.set('x-forwarded-proto', source.protocol.replace(':', ''))

    this.enter(upstream)
    let response: Response
    try {
      response = await this.send(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        // @ts-expect-error Deno accepts `duplex` for streamed request bodies.
        duplex: 'half',
      })
    } catch {
      this.leave(upstream)
      return new Response('Upstream unavailable', { status: 502 })
    }

    const outgoing = new Headers(response.headers)
    for (const name of HOP_BY_HOP) outgoing.delete(name)
    outgoing.delete('content-length')
    return new Response(this.tracked(response.body, upstream), {
      status: response.status,
      statusText: response.statusText,
      headers: outgoing,
    })
  }

  serve(options: { port: number; hostname?: string }): Deno.HttpServer {
    return Deno.serve(
      { ...options, onListen: () => {} },
      (request) => this.handle(request),
    )
  }

  /** Counts a request as in flight until its body is read, cancelled or fails. */
  private tracked(
    body: ReadableStream<Uint8Array> | null,
    upstream: string,
  ): ReadableStream<Uint8Array> | null {
    if (body === null) {
      this.leave(upstream)
      return null
    }
    const reader = body.getReader()
    let left = false
    const leave = () => {
      if (left) return
      left = true
      this.leave(upstream)
    }
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            leave()
          } else {
            controller.enqueue(value)
          }
        } catch (error) {
          controller.error(error)
          leave()
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {})
        leave()
      },
    })
  }

  private enter(upstream: string): void {
    this.inFlight.set(upstream, (this.inFlight.get(upstream) ?? 0) + 1)
  }

  private leave(upstream: string): void {
    const remaining = (this.inFlight.get(upstream) ?? 1) - 1
    if (remaining > 0) {
      this.inFlight.set(upstream, remaining)
      return
    }
    this.inFlight.delete(upstream)
    for (const done of this.waiters.get(upstream) ?? []) done()
    this.waiters.delete(upstream)
  }
}

function originOf(url: string): string {
  return new URL(url).origin
}
