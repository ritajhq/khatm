import type { z } from 'zod'
import * as Horizon from '@ritaj/horizon'
import type * as Storage from '@ritaj/storage'

import {
  type ErrorBody,
  type ErrorCode,
  type Input,
  type Output,
  type PlanStepView,
  type Procedure,
  type Procedures,
  procedures,
} from './procedures.ts'

/**
 * The control API as horizon messages: one per procedure, named after it, so
 * a packet posts to `/<procedure>` like a call to the control API does and
 * the console's guard matches it the same way. Procedures that only read are
 * queries; the rest are commands.
 */
const READS: ReadonlySet<string> = new Set([
  'khatm.plan',
  'khatm.status',
  'khatm.history',
  'khatm.events',
  'khatm.manifest',
  'khatm.doctor',
  'users.list',
  'users.lookup',
  'users.get',
  'audit.list',
])

/** Input fields that travel but never show in logs. */
const SECRET: ReadonlySet<string> = new Set(['password'])

/**
 * The control API refused the call for a reason the caller can act on: a
 * plan that went stale, a destructive change awaiting confirmation (`Steps`
 * says which), an invalid manifest (`Details` says why).
 */
export class Rejected extends Horizon.Fault {
  private readonly code = this.c.String('internal', 'fault.rejected.code')
  private readonly steps = this.c.Object<z.infer<typeof PlanStepView>[]>(
    [],
    'fault.rejected.steps',
  )
  private readonly details = this.c.Object<string[]>(
    [],
    'fault.rejected.details',
  )

  constructor(body?: ErrorBody['error']) {
    super(body?.message ?? '')
    if (!body) return
    this.code.Write(body.code)
    this.steps.Write(body.steps ?? [])
    this.details.Write(body.details ?? [])
  }

  get Code(): ErrorCode {
    return this.code.Read() as ErrorCode
  }

  get Steps(): z.infer<typeof PlanStepView>[] {
    return this.steps.Read()
  }

  get Details(): string[] {
    return this.details.Read()
  }
}

Horizon.Fault.Register(Rejected, '/khatm.rejected')

/** A procedure's input, one message field per input field. */
class Arguments<P extends Procedure> {
  private readonly fields = new Map<string, Storage.Primitive<unknown>>()

  constructor(
    codec: {
      Object<T extends object>(def: T, key: string): Storage.Primitive<T>
    },
    secret: {
      Object<T extends object>(def: T, key: string): Storage.Primitive<T>
    },
    procedure: P,
  ) {
    const shape =
      (procedure.input as unknown as { shape: Record<string, unknown> }).shape
    for (const name of Object.keys(shape)) {
      const declare = SECRET.has(name) ? secret : codec
      this.fields.set(
        name,
        declare.Object(
          undefined as unknown as object,
          `call.${name}`,
        ) as Storage.Primitive<unknown>,
      )
    }
  }

  Write(input: Input<P>): void {
    for (
      const [name, value] of Object.entries(input as Record<string, unknown>)
    ) {
      this.fields.get(name)?.Write(value)
    }
  }

  get Input(): Input<P> {
    const input: Record<string, unknown> = {}
    for (const [name, field] of this.fields) {
      const value = field.Read()
      if (value !== undefined) input[name] = value
    }
    return input as Input<P>
  }
}

/** What a call to `P` is answered with: its output, which is always plain JSON. */
export type Answer<P extends Procedure> = Output<P> & Horizon.DataStructure

/** A call to one procedure, as a horizon message. */
export interface Call<P extends Procedure>
  extends Horizon.Message<Answer<P>, Rejected> {
  readonly Procedure: P
  readonly Input: Input<P>
}

export type CallConstructor<P extends Procedure> = new (
  input?: Input<P>,
) => Call<P>

function query<P extends Procedure>(procedure: P): CallConstructor<P> {
  class Ask extends Horizon.Query<Answer<P>, Rejected> implements Call<P> {
    readonly Procedure = procedure
    private readonly arguments = new Arguments(this.c, this.secret, procedure)

    constructor(input?: Input<P>) {
      super()
      if (input) this.arguments.Write(input)
    }

    get Input(): Input<P> {
      return this.arguments.Input
    }
  }
  Horizon.Query.Register(Ask, `/${procedure.name}`)
  return Ask
}

function command<P extends Procedure>(procedure: P): CallConstructor<P> {
  class Issue extends Horizon.Action<Answer<P>, Rejected> implements Call<P> {
    readonly Procedure = procedure
    private readonly arguments = new Arguments(this.c, this.secret, procedure)

    constructor(input?: Input<P>) {
      super()
      if (input) this.arguments.Write(input)
    }

    get Input(): Input<P> {
      return this.arguments.Input
    }
  }
  Horizon.Action.Register(Issue, `/${procedure.name}`)
  return Issue
}

export type Calls = {
  readonly [K in keyof Procedures]: CallConstructor<Procedures[K]>
}

/** One message per procedure, keyed as `procedures` is: `new Calls.apply({ manifest })`. */
export const Calls: Calls = Object.fromEntries(
  Object.entries(procedures).map(([key, procedure]) => [
    key,
    READS.has(procedure.name) ? query(procedure) : command(procedure),
  ]),
) as unknown as Calls

/** Whether `call` is a command rather than a query. */
export function IsCommand(
  call: Call<Procedure>,
): call is Call<Procedure> & Horizon.Action<Horizon.DataStructure, Rejected> {
  return call instanceof Horizon.Action
}
