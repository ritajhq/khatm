import {
  ErrorBody,
  type Input,
  type Output,
  type Procedure,
  type Procedures,
  procedures,
} from '@khatm/contract'

export type Connection =
  /** Break-glass: the orchestrator's Unix socket, reached with `docker exec`. */
  | { readonly socket: string }
  /** The control port behind an idhn guard; `headers` carry the caller's session. */
  | { readonly url: string; readonly headers?: Record<string, string> }

/** A control API call that the server answered with an error. */
export class ControlError extends Error {
  constructor(readonly body: ErrorBody['error'], readonly status: number) {
    super(body.message)
  }

  get code(): ErrorBody['error']['code'] {
    return this.body.code
  }
}

export class Client {
  private readonly http: Deno.HttpClient | undefined
  private readonly base: string
  private readonly headers: Record<string, string>

  constructor(connection: Connection) {
    if ('socket' in connection) {
      this.http = Deno.createHttpClient({
        proxy: { transport: 'unix', path: connection.socket },
      } as Deno.CreateHttpClientOptions)
      this.base = 'http://khatm'
      this.headers = {}
    } else {
      this.base = connection.url.replace(/\/$/, '')
      this.headers = connection.headers ?? {}
    }
  }

  async call<P extends Procedure>(
    procedure: P,
    input: Input<P>,
  ): Promise<Output<P>> {
    const response = await fetch(`${this.base}/${procedure.name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify(procedure.input.parse(input)),
      client: this.http,
    } as RequestInit)
    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new ControlError(
        {
          code: 'internal',
          message: `Not a control API answer: ${text.slice(0, 200)}`,
        },
        response.status,
      )
    }
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(body)
      throw new ControlError(
        parsed.success
          ? parsed.data.error
          : { code: 'internal', message: `HTTP ${response.status}` },
        response.status,
      )
    }
    return procedure.output.parse(body) as Output<P>
  }

  /** The procedures as methods, so call sites read `client.api.plan({ manifest })`. */
  get api(): {
    [K in keyof Procedures]: (
      input: Input<Procedures[K]>,
    ) => Promise<Output<Procedures[K]>>
  } {
    return Object.fromEntries(
      Object.entries(procedures).map(([key, procedure]) => [
        key,
        (input: never) => this.call(procedure as Procedure, input),
      ]),
    ) as never
  }

  close(): void {
    this.http?.close()
  }
}
