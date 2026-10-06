import type { Data } from './serial.ts'
import * as Event from '@ritaj/event'

export class Primitive<T> {
  static Undefined(): Primitive<undefined> {
    return new Primitive(undefined, Obj)
  }

  static Number<T extends number>(value: T): Primitive<number> {
    return new Primitive(value, Numeric)
  }

  static ArrayOf<T extends Data>(value: T[] = []): Primitive<T[]> {
    return new Primitive(value, Obj)
  }

  static SetOf<T extends Data>(value: T[] = []): Primitive<Set<T>> {
    return new Primitive(new Set(value), UniqueList)
  }

  static MapOf<T extends Data>(
    value: [string, T][]
  ): Primitive<Map<string, T>> {
    return new Primitive(new Map(value), HashMap)
  }

  static Boolean(value: boolean = false): Primitive<boolean> {
    return new Primitive(value, Bool)
  }

  static String(value: string): Primitive<string> {
    return new Primitive(value, Str)
  }

  static Enum<T extends string | number>(value: T): Primitive<T> {
    return new Primitive(value, Obj)
  }

  static Record<T extends Record<PropertyKey, any>>(value: T): Primitive<T> {
    return new Primitive<T>(value, RecordC)
  }

  static Object<T extends object>(value: T): Primitive<T> {
    return new Primitive(value, Obj)
  }

  static Value<T, V extends Value<T>>(cls: V, value: T): Primitive<T> {
    return new Primitive(value, cls)
  }

  static Date(value: Date): Primitive<Date> {
    return new Primitive(value, DateCodec)
  }

  readonly OnChange = new Event.Delegate<[T, T]>()

  protected constructor(
    private value: T,
    private readonly codec: Value<T>
  ) {
    if (!codec) throw new Error('Codec is required for Primitive')
  }

  Read(): T {
    return this.value
  }

  Write<nT extends T>(setter: nT | Setter<T>, then?: (v: T) => void): T {
    const prev = this.value
    this.value = this.Evaluate(setter)
    if (!this.codec.IsEqual(prev, this.value)) {
      this.OnChange.Invoke(this.value, prev)
    }
    if (then) then(this.value)
    return this.value
  }

  FromData(data: Data): void {
    const prev = this.value
    this.value = this.codec.Deserialize(data)
    this.OnChange.Invoke(this.value, prev)
  }

  ToData(): Data {
    return this.codec.Serialize(this.value)
  }

  private Evaluate<nT extends T>(setter: nT | Setter<T>): T {
    if (setter instanceof Function) return setter(this.value)
    return setter
  }
}

class Numeric {
  static Serialize(value: number): number | string {
    if (value === +Infinity) return '+Infinity'
    if (value === -Infinity) return '-Infinity'
    if (Number.isNaN(value)) return 'NaN'
    return value
  }

  static Deserialize(value: string): number {
    if (value === '+Infinity') return +Infinity
    if (value === '-Infinity') return -Infinity
    if (value === 'NaN') return NaN
    return parseFloat(value)
  }

  static IsEqual(a: number, b: number): boolean {
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    return a === b
  }
}

class Str {
  static Serialize(value: string): string {
    return value
  }

  static Deserialize(value: string): string {
    return value
  }

  static IsEqual(a: string, b: string): boolean {
    return a === b
  }
}

class RecordC {
  static Serialize<T extends Record<PropertyKey, any>>(value: T): string {
    return JSON.stringify(value)
  }

  static Deserialize<T extends Record<PropertyKey, any>>(value: string): T {
    return JSON.parse(value) as T
  }

  static IsEqual(a: Record<string, any>, b: Record<string, any>): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }
}

class Obj {
  static Serialize(value: any): object {
    return value
  }

  static Deserialize(value: object): object {
    return value
  }

  static IsEqual(a: object, b: object): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }
}

class Bool {
  static Serialize(value: boolean): boolean {
    return value
  }

  static Deserialize(value: boolean): boolean {
    return value
  }

  static IsEqual(a: boolean, b: boolean): boolean {
    return a === b
  }
}

export class UniqueList {
  static Serialize(value: Set<any>): string {
    return JSON.stringify(Array.from(value))
  }

  static Deserialize(value: string): Set<any> {
    return new Set(JSON.parse(value))
  }

  static IsEqual(a: Set<any>, b: Set<any>): boolean {
    if (a.size !== b.size) return false
    for (const item of a) {
      if (!b.has(item)) return false
    }
    return true
  }
}

export class HashMap {
  static Serialize(value: Map<string, any>): string {
    const obj: Record<string, any> = {}
    value.forEach((v, k) => (obj[k] = v))
    return JSON.stringify(obj)
  }

  static Deserialize(value: string): Map<string, any> {
    const obj: Record<string, any> = JSON.parse(value)
    return new Map(Object.entries(obj))
  }

  static IsEqual(a: Map<string, any>, b: Map<string, any>): boolean {
    if (a.size !== b.size) return false
    for (const [k, v] of a) {
      if (!b.has(k) || b.get(k) !== v) return false
    }
    return true
  }
}

export type Value<T = any> = {
  Serialize(value: T): Data
  Deserialize(value: Data): T
  IsEqual(a: T, b: T): boolean
}

interface Setter<T> {
  (v: T): T
}

class DateCodec {
  static Serialize(v: Date): string {
    return v.toISOString()
  }

  static Deserialize(v: string): Date {
    return new Date(v)
  }

  static IsEqual(a: Date, b: Date): boolean {
    return a.getTime() === b.getTime()
  }
}
