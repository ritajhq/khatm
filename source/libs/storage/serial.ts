export interface SerialStorage {
  Read<T>(key: string, def: T): T
  Write<T>(key: string, value: T): void
  Dip(path: string, storable: Storable): void
  Partition(path: string): SerialStorage
  Clone(storage: SerialStorage): void
  get Serialized(): string
  Debug(): Record<string, any>
}

export abstract class Storable {
  abstract Dump(storage: SerialStorage): void
  abstract Restore(storage: SerialStorage): void

  static Empty(): Storable {
    return {
      Dump(_: SerialStorage): void {},
      Restore(_: SerialStorage): void {},
    }
  }
}

export type Data =
  | string
  | number
  | boolean
  | undefined
  | null
  | object
  | Data[]

export class Json implements SerialStorage {
  private root: Record<string, any> = {}
  private cursor: string[] = []

  static Empty(): Json {
    return new Json()
  }

  get Node(): Record<string, any> {
    let node = this.root
    for (const key of this.cursor) {
      if (!(key in node)) {
        node[key] = {}
      }
      node = node[key]
    }
    return node
  }

  Read<T>(key: string, def: T): T {
    return this.Node[key] ?? def
  }

  Write<T>(key: string, value: T): void {
    this.Node[key] = value
  }

  Dip(path: string, storable: Storable): void {
    const previousPath = this.cursor
    this.cursor = this.cursor.concat(path)
    storable.Dump(this)
    this.cursor = previousPath
  }

  Partition(path: string): SerialStorage {
    const partition = new Json()
    partition.cursor = this.cursor.concat(path)
    partition.root = this.root
    return partition
  }

  get Serialized(): string {
    return JSON.stringify(this.root)
  }

  Debug() {
    return {
      cursor: this.cursor,
      root: JSON.stringify(this.Node),
    }
  }

  Clone(target: SerialStorage): void {
    if (target instanceof Json) {
      target.root = this.root
      return
    }

    throw new Error('Cannot clone storage: missing implementation')
  }

  static Parse(json: string): Json {
    const storage = new Json()
    const parsed = JSON.parse(json)
    storage.root = parsed
    return storage
  }
}

export class Registry<T extends Storable = Storable> {
  private readonly restores = new Map<string, Restorer<T>>()

  constructor(private readonly types = new Map<Function, string>()) {}

  Dump(storage: SerialStorage, item: T): void {
    const type = this.types.get(item.constructor)
    if (!type) throw new Error(`Unknown type for object ${item}`)
    storage.Write('type', type)
    storage.Dip('data', item)
  }

  Restore(storage: SerialStorage): T {
    const type = storage.Read<string>('type', '')
    const data = storage.Partition('data')
    const restorer = this.restores.get(type)
    if (!restorer) throw new Error(`Unknown type ${type}`)
    return restorer.Restore(data)
  }

  Register(c: Constructor<T>, type: string): this {
    this.types.set(c, type)

    const restorer = new Restorer<T>(c)
    this.restores.set(type, restorer)

    return this
  }

  Read(item: T): string {
    const type = this.types.get(item.constructor)
    if (!type) throw new Error(`Unknown type for object ${item}`)
    return type
  }

  ReadConstructor(c: Constructor<T>): string | undefined {
    const type = this.types.get(c)

    if (!type) throw new Error(`Unknown type for constructor ${c.name}`)

    return type
  }

  get IsEmpty(): boolean {
    return this.types.size === 0
  }
}

class Restorer<T extends Storable> {
  constructor(protected readonly cls: Constructor<T>) {}

  Restore(sheet: SerialStorage): T {
    const obj = new this.cls()
    obj.Restore(sheet)
    return obj
  }
}

export interface Constructor<T> {
  new (...args: any[]): T
}
