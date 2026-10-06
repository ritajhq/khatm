import type * as MUX from '@ritaj/mux'

import * as Event from '@ritaj/event'

import type {
  AsyncResolver,
  AsyncResult,
  DataStructure,
  Handler,
  Message,
  Resolver,
} from './concepts.ts'
import { Action, Query, AsyncQuery, AsyncStatus } from './concepts.ts'
import { Crashed, Fault, Undelivered } from './fault.ts'

type ReturnedConstructor = new (packet: MUX.Packet) => MUX.Returned

export class Server {
  readonly OnResolved = new Event.Delegate<[Query<any, any> | AsyncQuery<any, any>]>()
  readonly OnHandled = new Event.Delegate<[Action<any, any>]>()

  private readonly returned = new Event.Delegate<[MUX.Returned]>()
  private readonly crashed = new Event.Delegate<[message: Message<any, any>, error: unknown, incident: string]>()

  constructor(
    private readonly resolver: Resolver<any> | AsyncResolver<any>,
    private readonly handler: Handler
  ) {}

  /**
   * A resolver or handler failed with something that isn't a fault: the
   * caller only gets a `Crashed` naming `incident`, this gets what actually
   * went wrong — for logging it, and later auditing it, in one place.
   */
  get OnCrashed(): Event.Emitter<[message: Message<any, any>, error: unknown, incident: string]> {
    return this.crashed
  }

  Use(transport: MUX.Duplex) {
    transport.OnReceving.Do(this.Switch)

    this.OnResolved.Do(transport.Send)
    this.OnHandled.Do(transport.Send)
    this.returned.Do(transport.Send)
  }

  async Resolve<T extends DataStructure>(q: Query<T, any> | AsyncQuery<T, any>): Promise<void> {
    try {
      if (q instanceof AsyncQuery) {
        const r = (await this.resolver.Resolve(q)) as AsyncResult<T>

        if (r.status === AsyncStatus.Completed) q.Complete(r.value!)
        if (r.status === AsyncStatus.Failed) q.Fail()

        this.OnResolved.Invoke(q)
        return
      }

      q.Wrap((await this.resolver.Resolve(q)) as T)
      this.OnResolved.Invoke(q)
    } catch (error) {
      this.Fail(q, error, () => this.OnResolved.Invoke(q))
    }
  }

  async Handle(a: Action<any, any>): Promise<void> {
    try {
      a.Wrap(await a.Execute(this.handler))
      this.OnHandled.Invoke(a)
    } catch (error) {
      this.Fail(a, error, () => this.OnHandled.Invoke(a))
    }
  }

  /**
   * Answers `message` with how it failed instead: a fault as itself, a
   * relayed refusal as the `Returned` it was, and anything else as `Crashed`.
   */
  private Fail(message: Message<any, any>, error: unknown, answer: () => void): void {
    if (error instanceof Undelivered) {
      this.returned.Invoke(new (error.Returned.constructor as ReturnedConstructor)(message))
      return
    }

    if (error instanceof Fault && error.IsRegistered) {
      message.Fail(error)
      answer()
      return
    }

    const incident = crypto.randomUUID()
    this.crashed.Invoke(message, error, incident)
    message.Fail(new Crashed(incident))
    answer()
  }

  private Switch = (packet: MUX.Packet): void => {
    switch (true) {
      case packet instanceof Query: {
        this.Resolve(packet)
        break
      }

      case packet instanceof Action: {
        this.Handle(packet)
        break
      }
    }
  }
}
