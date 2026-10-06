import type { Procedure } from '@khatm/contract'
import { type Answer, type Call, Rejected } from '@khatm/contract/messages'
import type * as Event from '@ritaj/event'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { Client as HttpCourier } from '@ritaj/mux/client/http'

/** How long the browser waits for a call: an apply or rollback waits for the new worker's health checks. */
const CALL_TIMEOUT_MS = 120_000

/**
 * The control API, as this console reaches it: horizon messages through the
 * console's own relay. The browser presents its session cookie by itself, so
 * nothing is carried here; a call the session no longer covers is reported
 * through `OnSessionRefused`.
 */
export class Control {
  private readonly courier: HttpCourier
  private readonly client: Horizon.Client

  constructor(origin: string) {
    this.courier = new HttpCourier(`${origin}/control`)
    this.client = new Horizon.Client(this.courier, { timeout: CALL_TIMEOUT_MS })
  }

  /** A call came back unauthenticated: the session is gone, and signing in again is the way back. */
  get OnSessionRefused(): Event.Emitter<
    [MUX.Credential | undefined, MUX.Unauthenticated]
  > {
    return this.courier.OnCredentialRefused
  }

  /** Makes the call, rejecting with its fault. */
  Send<P extends Procedure>(call: Call<P>): Promise<Answer<P>> {
    return this.client.Dispatch(call) as Promise<Answer<P>>
  }
}

type Describe = (error: never) => string

/** What each way a call can fail says to the operator, most specific first. */
const DESCRIPTIONS: readonly [new (...args: never[]) => unknown, Describe][] = [
  [
    Rejected,
    (e: Rejected) =>
      e.Details.length ? `${e.message}: ${e.Details.join('; ')}` : e.message,
  ],
  [
    Horizon.Crashed,
    (e: Horizon.Crashed) =>
      `The console failed to handle this (incident ${e.Incident})`,
  ],
  [
    Horizon.TimedOut,
    () => 'No answer in time: the control API may still be working on it',
  ],
  [Horizon.Unhandled, () => 'This console does not know that call'],
]

/** What came back undelivered says, by why it was returned. */
const RETURNED: readonly [new (packet: MUX.Packet) => MUX.Returned, string][] =
  [
    [MUX.Unauthenticated, 'Your session ended: sign in again'],
    [MUX.Forbidden, 'You are not allowed to do this'],
    [MUX.Unreachable, 'The control API cannot be reached'],
    [
      MUX.Unavailable,
      'The control API is unavailable right now: try again shortly',
    ],
  ]

/** One sentence for the operator, whatever the call failed with. */
export function Describe(error: unknown): string {
  if (error instanceof Horizon.Undelivered) {
    const reason = RETURNED.find(([kind]) => error.Returned instanceof kind)
    return reason?.[1] ?? 'The call could not be delivered'
  }
  const description = DESCRIPTIONS.find(([kind]) => error instanceof kind)
  if (description) return description[1](error as never)
  return error instanceof Error ? error.message : String(error)
}

export { Rejected }
