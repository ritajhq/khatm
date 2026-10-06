import type { AsyncOptions, DataStructure } from './concepts'
import { Action, AsyncQuery, AsyncStatus, Query } from './concepts'

import * as MUX from '@ritaj/mux'

import * as Event from '@ritaj/event'

// type Constructor<T> = new (...args: any[]) => T
type PromiseResolver<T> = (value: T | PromiseLike<T>) => void

export type ClientOptions = AsyncOptions

/**
 * What an `Ask` or `Issue` rejects with when the transport returned its
 * packet undelivered. `Returned` says why — tell reasons apart with
 * `instanceof` (`MUX.Forbidden`, `MUX.Unauthenticated`, …).
 */
export class ReturnedError extends Error {
  constructor(readonly Returned: MUX.Returned) {
    super(`${Returned.constructor.name}: the packet was returned undelivered`)
  }
}

export class Client {
  private readonly queries = {
    in_flight: new Map<
      string,
      { resolve: PromiseResolver<any>; reject: PromiseResolver<any> }
    >(),
    timeouts: new Map<string, NodeJS.Timeout>(),
    intervals: new Map<string, NodeJS.Timeout>(),
  }

  readonly onError = new Event.Delegate<[error: Error]>()

  private readonly returned = new Event.Delegate<[MUX.Returned]>()

  constructor(
    private readonly transport: MUX.Receiver & MUX.Sender,
    private readonly options: ClientOptions = {}
  ) {
    this.transport.OnReceving.Do(this.HandleAsync)
    this.transport.OnReceving.Do(this.HandleReturned)
  }

  /**
   * Every packet this client sent that came back undelivered — for handling
   * a reason the same way wherever it happens (e.g. signing in again on
   * `MUX.Unauthenticated`). The `Ask` or `Issue` that sent it rejects too.
   */
  get OnReturned(): Event.Emitter<[MUX.Returned]> {
    return this.returned
  }

  Ask<R extends DataStructure>(q: Query<R>, opts?: AsyncOptions): Promise<R>
  Ask<R extends DataStructure>(
    q: AsyncQuery<R>,
    opts?: AsyncOptions
  ): Promise<R>
  Ask<R extends DataStructure>(
    q: Query<R> | AsyncQuery<R>,
    opts: AsyncOptions = {}
  ): Promise<R> {
    const timeout = opts.timeout ?? this.options.timeout ?? 10_000
    const interval = opts.interval ?? this.options.interval ?? 1_500

    return new Promise<R>((resolve, reject) => {
      if (AsyncQuery.IsAsync(q)) {
        const unreturned = this.WhenReturned((p) => p instanceof AsyncQuery && q.Is(p), (error) => {
          answered.Dispose()
          this.queries.in_flight.delete(q.Hash)
          clearTimeout(this.queries.timeouts.get(q.Hash))
          clearInterval(this.queries.intervals.get(q.Hash))
          reject(error)
        })

        const answered = this.transport.OnReceving.Do((received, event) => {
          if (AsyncQuery.IsAsync(received) && received.Is(q)) {

            switch (received.Status) {
              case AsyncStatus.Completed: {
                event.Dispose()
                unreturned.Dispose()
                return resolve(received.Result)
              }

              case AsyncStatus.Failed: {
                event.Dispose()
                unreturned.Dispose()
                return reject(new Error('Async query failed'))
              }

              case AsyncStatus.Pending:
              default:
                if (this.queries.in_flight.has(q.Hash)) return

                this.queries.in_flight.set(q.Hash, { resolve, reject })

                const intervalId = setInterval(() => {
                  received.SendWith(this.transport)
                }, interval)

                const timer = setTimeout(() => {
                  this.queries.in_flight.delete(q.Hash)
                  clearInterval(intervalId)
                  unreturned.Dispose()
                  reject(new Error('Async query timed out'))
                }, timeout)

                this.queries.intervals.set(q.Hash, intervalId)
                this.queries.timeouts.set(q.Hash, timer)

                return
            }
          }
        })

        q.SendWith(this.transport)
        return
      }

      // Plain queries have no submit/poll cycle, but the transport can still
      // fail (bad response, network error) without ever echoing a matching
      // packet back — without a timeout this promise would hang forever.
      let timer: ReturnType<typeof setTimeout>

      const unreturned = this.WhenReturned((p) => p instanceof Query && q.Is(p), (error) => {
        subscription.Dispose()
        clearTimeout(timer)
        reject(error)
      })

      const subscription = this.transport.OnReceving.Do((received, event) => {
        if (received instanceof Query && !AsyncQuery.IsAsync(received)) {
          if (received.Is(q)) {
            event.Dispose()
            unreturned.Dispose()
            clearTimeout(timer)
            return resolve(received.Result)
          }
        }
      })

      timer = setTimeout(() => {
        subscription.Dispose()
        unreturned.Dispose()
        reject(new Error('Query timed out'))
      }, timeout)

      q.SendWith(this.transport)
    })
  }

  /**
   * Issue an action and await its return payload. The server echoes the action
   * back with its result wrapped; we match the echo by nonce (via `Is`) and
   * resolve with the payload, rejecting on timeout.
   */
  Issue<R extends DataStructure>(a: Action<R>, opts: AsyncOptions = {}): Promise<R> {
    const timeout = opts.timeout ?? this.options.timeout ?? 10_000

    return new Promise<R>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>

      const unreturned = this.WhenReturned((p) => p instanceof Action && a.Is(p), (error) => {
        subscription.Dispose()
        clearTimeout(timer)
        reject(error)
      })

      const subscription = this.transport.OnReceving.Do((received, event) => {
        if (received instanceof Action && received.Is(a)) {
          event.Dispose()
          unreturned.Dispose()
          clearTimeout(timer)
          resolve(received.Result as R)
        }
      })

      timer = setTimeout(() => {
        subscription.Dispose()
        unreturned.Dispose()
        reject(new Error('Action timed out'))
      }, timeout)

      a.SendWith(this.transport)
    })
  }

  Listen<T extends MUX.Packet>(type: Event.Constructor<T>, cb: (p: T) => void): Event.Disposable {
    return this.transport.OnReceving.Do(packet => {
      if (packet instanceof type) cb(packet as T)
    })
  }

  /**
   * Calls `returned` once, when the transport hands back undelivered the
   * packet `isSent` recognizes — the way its answer would be recognized
   * (`Is`: by hash for a query, by nonce for an action).
   */
  private WhenReturned(
    isSent: (packet: MUX.Packet) => boolean,
    returned: (error: ReturnedError) => void
  ): Event.Disposable {
    return this.transport.OnReceving.Do((received, event) => {
      if (!(received instanceof MUX.Returned)) return
      if (!isSent(received.Packet)) return

      event.Dispose()
      returned(new ReturnedError(received))
    })
  }

  private HandleReturned = (p: MUX.Packet): void => {
    if (p instanceof MUX.Returned) this.returned.Invoke(p)
  }

  private HandleAsync = (p: MUX.Packet): void  =>{
    if (!AsyncQuery.IsAsync(p)) return

    const deferred = this.queries.in_flight.get(p.Hash)

    if (!deferred) return

    switch (p.Status) {
      case AsyncStatus.Completed:
        deferred.resolve(p.Result)
        this.queries.in_flight.delete(p.Hash)
        clearTimeout(this.queries.timeouts.get(p.Hash))
        clearInterval(this.queries.intervals.get(p.Hash))
        return

      case AsyncStatus.Failed:
        deferred.reject(new Error('Async query failed'))
        this.queries.in_flight.delete(p.Hash)
        clearTimeout(this.queries.timeouts.get(p.Hash))
        clearInterval(this.queries.intervals.get(p.Hash))
        return

      case AsyncStatus.Pending:
      default:
        return
    }
  }
}
