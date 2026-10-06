import type { AsyncOptions, DataStructure, Message } from './concepts.ts'
import { Action, AsyncQuery, AsyncStatus, Query } from './concepts.ts'
import { Crashed, Fault, type ProtocolFault, TimedOut, Undelivered } from './fault.ts'

import * as MUX from '@ritaj/mux'

import * as Event from '@ritaj/event'

type PromiseResolver<T> = (value: T | PromiseLike<T>) => void
type Timer = ReturnType<typeof setTimeout>

export type ClientOptions = AsyncOptions

/**
 * How a query or command ended, for a caller that handles its faults where
 * it makes the call: answered with `Value`, or ended with one of the faults
 * it declares (`F`) or a protocol one.
 */
export type Outcome<R, F extends Fault> =
  | { readonly ok: true; readonly value: R }
  | { readonly ok: false; readonly fault: F | ProtocolFault }

/** What a query or command is answered with. */
export type AnswerOf<M> = M extends Message<infer R, any> ? R : never

/** The app faults a query or command declares. */
export type FaultsOf<M> = M extends Message<any, infer F> ? F : never

export class Client {
  private readonly queries = {
    in_flight: new Map<
      string,
      { resolve: PromiseResolver<any>; reject: (fault: Fault) => void }
    >(),
    timeouts: new Map<string, Timer>(),
    intervals: new Map<string, Timer>(),
  }

  private readonly returned = new Event.Delegate<[MUX.Returned]>()
  private readonly faulted = new Event.Delegate<[Fault]>()

  constructor(
    private readonly transport: MUX.Receiver & MUX.Sender,
    private readonly options: ClientOptions = {}
  ) {
    this.transport.OnReceving.Do(this.HandleAsync)
    this.transport.OnReceving.Do(this.HandleReturned)
  }

  /**
   * Every packet this client sent that came back undelivered — for handling
   * a reason the same way wherever it happens. The `Ask` or `Issue` that sent
   * it rejects too, with `Undelivered`.
   */
  get OnReturned(): Event.Emitter<[MUX.Returned]> {
    return this.returned
  }

  /**
   * Every fault any query or command ended with, app or protocol — for
   * reacting to them in one place (logging, a notice for `Crashed`). The call
   * that made it still rejects with it, or returns it from `Attempt`.
   */
  get OnFault(): Event.Emitter<[Fault]> {
    return this.faulted
  }

  Ask<R extends DataStructure>(q: Query<R, any>, opts?: AsyncOptions): Promise<R>
  Ask<R extends DataStructure>(
    q: AsyncQuery<R, any>,
    opts?: AsyncOptions
  ): Promise<R>
  Ask<R extends DataStructure>(
    q: Query<R, any> | AsyncQuery<R, any>,
    opts: AsyncOptions = {}
  ): Promise<R> {
    const timeout = opts.timeout ?? this.options.timeout ?? 10_000
    const interval = opts.interval ?? this.options.interval ?? 1_500

    return new Promise<R>((resolve, rejectWith) => {
      const reject = (fault: Fault) => this.Reject(rejectWith, fault)

      if (AsyncQuery.IsAsync(q)) {
        const unreturned = this.WhenReturned((p) => p instanceof AsyncQuery && q.Is(p), (fault) => {
          answered.Dispose()
          this.queries.in_flight.delete(q.Hash)
          clearTimeout(this.queries.timeouts.get(q.Hash))
          clearInterval(this.queries.intervals.get(q.Hash))
          reject(fault)
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
                return reject(received.Fault ?? new Crashed())
              }

              case AsyncStatus.Pending:
              default: {
                if (this.queries.in_flight.has(q.Hash)) return

                this.queries.in_flight.set(q.Hash, { resolve, reject })

                const intervalId = setInterval(() => {
                  received.SendWith(this.transport)
                }, interval)

                const timer = setTimeout(() => {
                  this.queries.in_flight.delete(q.Hash)
                  clearInterval(intervalId)
                  unreturned.Dispose()
                  reject(new TimedOut('The async query was still pending when it timed out'))
                }, timeout)

                this.queries.intervals.set(q.Hash, intervalId)
                this.queries.timeouts.set(q.Hash, timer)

                return
              }
            }
          }
        })

        q.SendWith(this.transport)
        return
      }

      // Plain queries have no submit/poll cycle, but the transport can still
      // fail (bad response, network error) without ever echoing a matching
      // packet back — without a timeout this promise would hang forever.
      let timer: Timer

      const unreturned = this.WhenReturned((p) => p instanceof Query && q.Is(p), (fault) => {
        subscription.Dispose()
        clearTimeout(timer)
        reject(fault)
      })

      const subscription = this.transport.OnReceving.Do((received, event) => {
        if (received instanceof Query && !AsyncQuery.IsAsync(received)) {
          if (received.Is(q)) {
            event.Dispose()
            unreturned.Dispose()
            clearTimeout(timer)
            this.Settle(received, resolve, reject)
          }
        }
      })

      timer = setTimeout(() => {
        subscription.Dispose()
        unreturned.Dispose()
        reject(new TimedOut('The query timed out'))
      }, timeout)

      q.SendWith(this.transport)
    })
  }

  /**
   * Issue an action and await its return payload. The server echoes the action
   * back with its result wrapped; we match the echo by nonce (via `Is`) and
   * resolve with the payload, rejecting on timeout.
   */
  Issue<R extends DataStructure>(a: Action<R, any>, opts: AsyncOptions = {}): Promise<R> {
    const timeout = opts.timeout ?? this.options.timeout ?? 10_000

    return new Promise<R>((resolve, rejectWith) => {
      const reject = (fault: Fault) => this.Reject(rejectWith, fault)
      let timer: Timer

      const unreturned = this.WhenReturned((p) => p instanceof Action && a.Is(p), (fault) => {
        subscription.Dispose()
        clearTimeout(timer)
        reject(fault)
      })

      const subscription = this.transport.OnReceving.Do((received, event) => {
        if (received instanceof Action && received.Is(a)) {
          event.Dispose()
          unreturned.Dispose()
          clearTimeout(timer)
          this.Settle(received, resolve, reject)
        }
      })

      timer = setTimeout(() => {
        subscription.Dispose()
        unreturned.Dispose()
        reject(new TimedOut('The action timed out'))
      }, timeout)

      a.SendWith(this.transport)
    })
  }

  /**
   * Asks the query or issues the command, and hands back how it ended
   * instead of rejecting: the compiler then makes the caller handle the
   * faults it declares.
   */
  async Attempt<M extends Message<any, any>>(
    m: M,
    opts: AsyncOptions = {}
  ): Promise<Outcome<AnswerOf<M>, FaultsOf<M>>> {
    try {
      return { ok: true, value: await this.Dispatch(m, opts) }
    } catch (error) {
      if (error instanceof Fault) return { ok: false, fault: error as FaultsOf<M> | ProtocolFault }
      throw error
    }
  }

  /**
   * Asks it if it is a query, issues it if it is a command — for code that
   * handles messages without knowing which kind each is. Rejects as `Ask`
   * and `Issue` do.
   */
  Dispatch<M extends Message<any, any>>(m: M, opts: AsyncOptions = {}): Promise<AnswerOf<M>> {
    return m instanceof Action
      ? this.Issue(m, opts)
      : this.Ask(m as unknown as Query<any, any>, opts)
  }

  Listen<T extends MUX.Packet>(type: Event.Constructor<T>, cb: (p: T) => void): Event.Disposable {
    return this.transport.OnReceving.Do(packet => {
      if (packet instanceof type) cb(packet as T)
    })
  }

  /** Resolves with the answer `received` carries, or rejects with the fault it ended with. */
  private Settle<R>(
    received: Query<any, any> | Action<any, any>,
    resolve: PromiseResolver<R>,
    reject: (fault: Fault) => void
  ): void {
    const fault = received.Fault
    if (fault) return reject(fault)

    resolve(received.Result as R)
  }

  /** Every fault goes through here, so `OnFault` sees each one the caller does. */
  private Reject(reject: (reason: Fault) => void, fault: Fault): void {
    this.faulted.Invoke(fault)
    reject(fault)
  }

  /**
   * Calls `returned` once, when the transport hands back undelivered the
   * packet `isSent` recognizes — the way its answer would be recognized
   * (`Is`: by hash for a query, by nonce for an action).
   */
  private WhenReturned(
    isSent: (packet: MUX.Packet) => boolean,
    returned: (fault: Undelivered) => void
  ): Event.Disposable {
    return this.transport.OnReceving.Do((received, event) => {
      if (!(received instanceof MUX.Returned)) return
      if (!isSent(received.Packet)) return

      event.Dispose()
      returned(new Undelivered(received))
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
        deferred.reject(p.Fault ?? new Crashed())
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
