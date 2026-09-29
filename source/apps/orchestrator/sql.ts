import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

export type Row = Record<string, unknown>

/** The little the stores need from a database; `?` marks parameters. */
export interface SqlClient {
  readonly dialect: 'sqlite' | 'postgres'
  execute(
    sql: string,
    params?: readonly (string | number | null)[],
  ): Promise<{ rows: Row[]; changes: number }>
  close(): Promise<void>
}

export class UnsupportedStoreError extends Error {}

/** `postgres://…` connects to Postgres; anything else is a SQLite file path. */
export function openSql(location: string): SqlClient {
  if (/^postgres(ql)?:\/\//.test(location)) return postgresClient(location)
  return sqliteClient(location.replace(/^sqlite:(\/\/)?/, ''))
}

function sqliteClient(path: string): SqlClient {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  return {
    dialect: 'sqlite',
    execute(sql, params = []) {
      const statement = db.prepare(sql)
      if (/^\s*(select|with)\b/i.test(sql)) {
        return Promise.resolve({
          rows: statement.all(...params) as Row[],
          changes: 0,
        })
      }
      const result = statement.run(...params)
      return Promise.resolve({ rows: [], changes: Number(result.changes) })
    },
    close() {
      db.close()
      return Promise.resolve()
    },
  }
}

function postgresClient(url: string): SqlClient {
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  return {
    dialect: 'postgres',
    async execute(sql, params = []) {
      let n = 0
      const result = await pool.query(
        sql.replace(/\?/g, () => `$${++n}`),
        [...params],
      )
      return { rows: result.rows as Row[], changes: result.rowCount ?? 0 }
    },
    async close() {
      await pool.end()
    },
  }
}
