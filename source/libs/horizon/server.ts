import type * as MUX from '@ritaj/mux'
import type * as Storage from '@ritaj/storage'

import * as Event from '@ritaj/event'

import type {
  AsyncResolver,
  AsyncResult,
  DataStructure,
  Handler,
  Resolver,
} from './concepts'
import { Action, Query, AsyncQuery, AsyncStatus } from './concepts'

export interface Server {
  Resolve<T extends Storage.Storable>(q: Query<T>): void
  Handle(a: Action): void
}

export class Server {
  readonly OnResolved = new Event.Delegate<[Query<any> | AsyncQuery<any>]>()
  readonly OnHandled = new Event.Delegate<[Action]>()

  constructor(
    private readonly resolver: Resolver<any> | AsyncResolver<any>,
    private readonly handler: Handler
  ) {}

  Use(transport: MUX.Duplex) {
    transport.OnReceving.Do(this.Switch)

    this.OnResolved.Do(transport.Send)
    this.OnHandled.Do(transport.Send)
  }

  Resolve<T extends DataStructure>(q: AsyncQuery<T>): Promise<[T, Query<T>]>
  Resolve<T extends DataStructure>(q: Query<T>): Promise<[T, Query<T>]>
  async Resolve<T extends DataStructure>(
    q: Query<T> | AsyncQuery<T>
  ): Promise<[T | AsyncResult<T>, Query<T> | AsyncQuery<T>]> {
    if (q instanceof AsyncQuery) {
      const r = (await this.resolver.Resolve(q)) as AsyncResult<T>

      if (r.status === AsyncStatus.Completed) {
        q.Complete(r.value!)
      }

      if (r.status === AsyncStatus.Failed) {
        q.Fail()
      }

      this.OnResolved.Invoke(q)
      return [r, q] as const
    }

    if (q instanceof Query) {
      const r = (await this.resolver.Resolve(q)) as T
      this.Answer(r, q)
      return [r, q] as const
    }

    throw new Error('Unknown query type')
  }

  async Handle(a: Action) {
    const r = await a.Execute(this.handler)
    a.Wrap(r)
    this.Notify(a)
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

  private Answer = (d: DataStructure, q: Query<DataStructure>) => {
    q.Wrap(d)
    this.OnResolved.Invoke(q)
  }

  private Notify = (a: Action) => {
    this.OnHandled.Invoke(a)
  }
}
