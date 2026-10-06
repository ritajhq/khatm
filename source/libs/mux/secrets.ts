import * as Storage from '@ritaj/storage'

/** What a secret field shows wherever something is written out for a person or a log. */
export const HIDDEN = '[secret]'

/**
 * Declares fields that travel like any other — the receiving side needs them
 * — but are never shown: whenever their owner is written out for a person or
 * a log rather than for the wire, they read `[secret]`. Nothing else; what a
 * caller may see of an answer is for whatever authorizes it to decide.
 *
 *   private readonly password = this.secret.String('', 'action.set_password.password')
 */
export class Secrets {
  private readonly keys = new Set<string>()

  constructor(private readonly codec: Storage.Codec) {}

  String(def: string, key: string): Storage.Primitive<string> {
    this.keys.add(key)
    return this.codec.String(def, key)
  }

  Number(def: number, key: string): Storage.Primitive<number> {
    this.keys.add(key)
    return this.codec.Number(def, key)
  }

  Record<T extends Record<PropertyKey, any>>(def: T, key: string): Storage.Primitive<T> {
    this.keys.add(key)
    return this.codec.Record(def, key)
  }

  Object<T extends object>(def: T, key: string): Storage.Primitive<T> {
    this.keys.add(key)
    return this.codec.Object(def, key)
  }

  /** Every field, the secret ones hidden: what a person or a log may see. */
  Disclose(): Record<string, unknown> {
    const sheet = Storage.Json.Empty()
    this.codec.Dump(sheet)
    const fields: Record<string, unknown> = JSON.parse(sheet.Serialized)
    for (const key of this.keys) {
      if (key in fields) fields[key] = HIDDEN
    }
    return fields
  }
}

/** The inspection hooks Deno and Node call for `console.log`, so logging an object shows what `toJSON` does. */
export const INSPECT = [Symbol.for('Deno.customInspect'), Symbol.for('nodejs.util.inspect.custom')] as const
