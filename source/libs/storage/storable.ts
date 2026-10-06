import { Primitive, type Value } from './primitive.ts'
import { Json, type Data, type SerialStorage, type Storable } from './serial.ts'
import * as Event from '@ritaj/event'

export class Codec implements Storable {
  private partitions = new Map<string, Storable>()
  private primitives = new Map<string, Primitive<any>>()

  Number(def: number, key: string): Primitive<number> {
    const prm = Primitive.Number(def)
    this.primitives.set(key, prm)
    return prm
  }

  String(def: string, key: string): Primitive<string> {
    const prm = Primitive.String(def)
    this.primitives.set(key, prm)
    return prm
  }

  Boolean(def: boolean, key: string): Primitive<boolean> {
    const prm = Primitive.Boolean(def)
    this.primitives.set(key, prm)
    return prm
  }

  Enum<T extends string | number>(def: T, key: string): Primitive<T> {
    const prm = Primitive.Enum(def)
    this.primitives.set(key, prm)
    return prm
  }

  Record<T extends Record<PropertyKey, any>>(def: T, key: string): Primitive<T> {
    const prm = Primitive.Record(def)
    this.primitives.set(key, prm)
    return prm
  }

  Object<T extends object>(def: T, key: string): Primitive<T> {
    const prm = Primitive.Object(def)
    this.primitives.set(key, prm)
    return prm
  }

  ArrayOf<T extends Data>(def: T[], key: string): Primitive<T[]> {
    const prm = Primitive.ArrayOf(def)
    this.primitives.set(key, prm)
    return prm
  }

  SetOf<T extends Data>(def: T[], key: string): Primitive<Set<T>> {
    const prm = Primitive.SetOf(def)
    this.primitives.set(key, prm)
    return prm
  }

  MapOf<T extends Data>(
    def: [string, T][],
    key: string,
  ): Primitive<Map<string, T>> {
    const prm = Primitive.MapOf(def)
    this.primitives.set(key, prm)
    return prm
  }

  Value<T, V extends Value<T>>(cls: V, value: T, key: string): Primitive<T> {
    const prm = Primitive.Value(cls, value)
    this.primitives.set(key, prm)
    return prm
  }

  Date(def: Date, key: string): Primitive<Date> {
    const prm = Primitive.Date(def)
    this.primitives.set(key, prm)
    return prm
  }

  Store<T extends Storable>(storable: T, key: string): T {
    this.partitions.set(key, storable)
    return storable
  }

  Preserve(key: string, storable: Storable | Primitive<any>): this {
    if (IsPrimitive(storable)) {
      this.primitives.set(key, storable)
      return this
    }

    if (IsStorable(storable)) {
      this.partitions.set(key, storable)
      return this
    }

    throw new Error(`Cannot preserve ${key} as it is not a Storable, Primitive`)
  }

  Clone(): Codec {
    const clone = new Codec()

    this.primitives.forEach((prm, key) => {
      clone.primitives.set(key, prm)
    })

    this.partitions.forEach((sto, key) => {
      clone.partitions.set(key, sto)
    })

    return clone
  }

  /**
   * Returns a new Codec instance with the specified key excluded from the dump.
   * It does not modify the original Codec instance.
   *
   * @param key The key to be excluded from the dump.
   */
  Exclude(key: string): Codec {
    const clone = this.Clone()

    clone.primitives.delete(key)
    clone.partitions.delete(key)

    return clone
  }

  Dump = (storage: SerialStorage) => {
    this.primitives.forEach((prm, key) => {
      storage.Write(key, prm.ToData())
    })

    this.partitions.forEach((sto, key) => {
      storage.Dip(key, sto)
    })
  }

  Restore = (storage: SerialStorage) => {
    this.primitives.forEach((prm, key) => {
      prm.FromData(storage.Read(key, prm.ToData()))
    })

    this.partitions.forEach((sto, key) => {
      sto.Restore(storage.Partition(key))
    })
  }

  ToJSON = () => {
    const sheet = Json.Empty()

    this.Dump(sheet)

    return sheet.Serialized
  }

  FromJSON = (json: string) => {
    const sheet = Json.Parse(json)

    this.Restore(sheet)
  }
}

function IsPrimitive(obj: any): obj is Primitive<Data> {
  return obj instanceof Primitive
}

function IsStorable(obj: any): obj is Storable {
  return (
    obj && typeof obj.Dump === 'function' && typeof obj.Restore === 'function'
  )
}

type Constructor<T = any> = new (...args: any[]) => T

export function AutoCodecAccessors<T extends Storable>(
  cls: Constructor<T>,
): void {
  const proto = cls.prototype

  // Loop through the properties of the class, check if are Codec primitives using IsPrimitive, and if so, create getters and setters for them
  const keys = Object.getOwnPropertyNames(proto)

  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)

    if (
      !descriptor ||
      typeof descriptor.value !== 'object' ||
      !IsPrimitive(descriptor.value)
    ) {
      continue
    }

    const value = descriptor.value

    Object.defineProperty(proto, key, {
      get: function () {
        return value.Read()
      },
      set: function (newValue) {
        value.Write(newValue)
      },
      enumerable: true,
      configurable: true,
    })
  }
}
