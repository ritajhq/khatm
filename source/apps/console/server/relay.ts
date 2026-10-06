import { Client, ControlError } from '@khatm/client'
import type { Procedure } from '@khatm/contract'
import {
  type Answer,
  type Call,
  Calls,
  IsCommand,
  Rejected,
} from '@khatm/contract/messages'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'

type ReturnedConstructor = new (packet: MUX.Packet) => MUX.Returned

/** How a refusal on the way to the control API is returned to the browser, as mux's HTTP client stamps them. */
const RETURNED_FOR_STATUS: Readonly<Record<number, ReturnedConstructor>> = {
  401: MUX.Unauthenticated,
  403: MUX.Forbidden,
  502: MUX.Unreachable,
  503: MUX.Unavailable,
  504: MUX.Unavailable,
}

/**
 * Passes each call on to the control API on behalf of whoever sent it, with
 * the credential they presented: the control API's guard decides, never the
 * console. What comes back is told apart on the way:
 *
 * - an answer, sent back as the answer;
 * - a refusal on the way (a guard's 401 or 403, the API unreachable), sent
 *   back as the same `Returned`, as if the browser had made the call itself;
 * - the control API rejecting the call itself (`stale_plan`,
 *   `confirmation_required`, …), sent back as a `Rejected` fault.
 */
export class Relay implements Horizon.Resolver, Horizon.Handler {
  constructor(private readonly controlUrl: string) {}

  /** Has every control call resolved or handled by this relay. */
  Serve(resolvers: Horizon.Resolvers, handlers: Horizon.Handlers): void {
    for (const call of Object.values(Calls)) {
      if (IsCommand(new call())) handlers.Use(call as never, this as never)
      else resolvers.Use(call as never, this as never)
    }
  }

  Resolve(call: Call<Procedure>): Promise<Answer<Procedure>> {
    return this.Pass(call)
  }

  Handle(call: Call<Procedure>): Promise<Answer<Procedure>> {
    return this.Pass(call)
  }

  private async Pass(call: Call<Procedure>): Promise<Answer<Procedure>> {
    const envelope = new MUX.Envelope()
    call.Credential?.PresentIn(envelope)
    const client = new Client({
      url: this.controlUrl,
      headers: envelope.Fields,
    })
    try {
      return await client.call(call.Procedure, call.Input) as Answer<Procedure>
    } catch (error) {
      throw this.Translate(call, error)
    }
  }

  private Translate(call: Call<Procedure>, error: unknown): unknown {
    if (error instanceof TypeError) {
      // fetch itself failed: the control API could not be reached.
      return new Horizon.Undelivered(new MUX.Unreachable(call))
    }
    if (!(error instanceof ControlError)) return error

    if (error.code === 'unauthenticated') {
      return new Horizon.Undelivered(new MUX.Unauthenticated(call))
    }
    if (error.code !== 'internal') return new Rejected(error.body)

    // Not a control API answer: whatever stood in the way said why by its status.
    const returned = RETURNED_FOR_STATUS[error.status]
    return returned ? new Horizon.Undelivered(new returned(call)) : error
  }
}
