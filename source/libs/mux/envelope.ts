/**
 * What a packet travels in, in the one form every transport can put it in:
 * named fields beside the packet, never inside it. HTTP fills it from the
 * request's headers, a WebSocket from its upgrade request (or a
 * `Presentation`), Lambda from its event. Credentials are read from it and
 * presented into it, so neither a mechanism nor a credential has to know
 * which transport it is on.
 */
export class Envelope {
  private readonly fields: Headers

  constructor(fields: HeadersInit = {}) {
    this.fields = new Headers(fields)
  }

  Header(name: string): string | undefined {
    return this.fields.get(name) ?? undefined
  }

  /** The value of one cookie the envelope carries. */
  Cookie(name: string): string | undefined {
    for (const pair of (this.Header('cookie') ?? '').split(';')) {
      const separator = pair.indexOf('=')
      if (separator === -1) continue
      if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim()
    }
    return undefined
  }

  /** The credentials of an `Authorization: <scheme> <value>` field, when it uses `scheme`. */
  Authorization(scheme: string): string | undefined {
    const [given, ...rest] = (this.Header('authorization') ?? '').split(' ')
    if (rest.length === 0 || given.toLowerCase() !== scheme.toLowerCase()) return undefined
    return rest.join(' ')
  }

  SetHeader(name: string, value: string): void {
    this.fields.set(name, value)
  }

  SetCookie(name: string, value: string): void {
    const others = this.Header('cookie')
    this.fields.set('cookie', others ? `${others}; ${name}=${value}` : `${name}=${value}`)
  }

  /** Every field, for a transport to send or carry them. */
  get Fields(): Record<string, string> {
    return Object.fromEntries(this.fields.entries())
  }

  /** Copies every field onto `headers`, for a transport that sends real headers. */
  WriteTo(headers: Headers): void {
    for (const [name, value] of this.fields) headers.set(name, value)
  }
}
