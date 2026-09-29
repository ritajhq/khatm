import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import type { DatabaseSpec } from '@khatm/spec'

export interface OpenDatabase {
  /** What `betterAuth({ database })` takes. */
  readonly database: unknown
  close(): Promise<void>
}

export class UnsupportedDialectError extends Error {
  constructor(readonly dialect: string) {
    super(`The ${dialect} dialect isn't supported by this build yet`)
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Opens the database Better Auth's tables live in. `url` is what the
 * spec's secret reference resolved to: a connection string for Postgres, a
 * file path for SQLite.
 */
export function openDatabase(spec: DatabaseSpec, url: string): OpenDatabase {
  switch (spec.dialect) {
    case 'sqlite': {
      const db = new DatabaseSync(url)
      // Two workers open the same file during a swap: WAL lets a reader
      // and a writer coexist, and the timeout waits out a short lock.
      db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      return { database: db, close: () => Promise.resolve(db.close()) }
    }
    case 'postgres': {
      const pool = new pg.Pool({
        connectionString: url,
        options: spec.schema === undefined
          ? undefined
          : `-c search_path=${checkedIdentifier(spec.schema)},public`,
      })
      return { database: pool, close: () => pool.end() }
    }
    default:
      throw new UnsupportedDialectError(spec.dialect)
  }
}

/** Creates the Postgres schema Better Auth's tables go in, if the spec names one and it's missing. */
export async function ensureSchema(
  spec: DatabaseSpec,
  url: string,
): Promise<void> {
  if (spec.dialect !== 'postgres' || spec.schema === undefined) return
  const pool = new pg.Pool({ connectionString: url })
  try {
    await pool.query(
      `create schema if not exists "${checkedIdentifier(spec.schema)}"`,
    )
  } finally {
    await pool.end()
  }
}

function checkedIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`"${name}" isn't a plain schema name`)
  }
  return name
}
