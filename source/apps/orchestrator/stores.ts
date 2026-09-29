import {
  type Json,
  type ResolvedManifest,
  Revision,
  type SecretFingerprints,
} from '@khatm/spec'
import {
  type ActiveState,
  type ApplyLock,
  type Lease,
  type RevisionStore,
  StaleBaseError,
} from '@khatm/deployment'
import type { SqlClient } from './sql.ts'

/** Tables live in the `khatm` schema on Postgres and carry a `khatm_` prefix elsewhere. */
export function tables(client: SqlClient) {
  const name = (table: string) =>
    client.dialect === 'postgres' ? `khatm.${table}` : `khatm_${table}`
  return {
    revisions: name('revisions'),
    state: name('state'),
    lock: name('apply_lock'),
    installation: name('installation'),
    audit: name('audit'),
  }
}

/** Creates what is missing; safe to run on every start and from several instances. */
export async function migrateStore(client: SqlClient): Promise<void> {
  const t = tables(client)
  if (client.dialect === 'postgres') {
    await client.execute('CREATE SCHEMA IF NOT EXISTS khatm')
  }
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${t.installation} (
       name TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ${t.revisions} (
       seq ${
      client.dialect === 'postgres' ? 'BIGSERIAL' : 'INTEGER'
    } PRIMARY KEY${client.dialect === 'sqlite' ? ' AUTOINCREMENT' : ''},
       id TEXT NOT NULL UNIQUE,
       parent TEXT,
       manifest TEXT NOT NULL,
       author TEXT NOT NULL,
       reason TEXT,
       created_at TEXT NOT NULL,
       resolved TEXT NOT NULL,
       fingerprints TEXT NOT NULL,
       authored TEXT)`,
    `CREATE TABLE IF NOT EXISTS ${t.state} (
       id INTEGER PRIMARY KEY, active_revision TEXT)`,
    `CREATE TABLE IF NOT EXISTS ${t.lock} (
       id INTEGER PRIMARY KEY, owner TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ${t.audit} (
       seq ${
      client.dialect === 'postgres' ? 'BIGSERIAL' : 'INTEGER'
    } PRIMARY KEY${client.dialect === 'sqlite' ? ' AUTOINCREMENT' : ''},
       at TEXT NOT NULL,
       actor TEXT NOT NULL,
       action TEXT NOT NULL,
       target TEXT,
       revision TEXT,
       outcome TEXT NOT NULL,
       details TEXT NOT NULL)`,
  ]
  for (const statement of statements) await client.execute(statement)
  await client.execute(
    `INSERT INTO ${t.state} (id, active_revision) VALUES (1, NULL)
     ON CONFLICT (id) DO NOTHING`,
  )
}

/** The per-installation key secret fingerprints are keyed with; made once. */
export async function installationKey(client: SqlClient): Promise<string> {
  const t = tables(client)
  await client.execute(
    `INSERT INTO ${t.installation} (name, value) VALUES ('fingerprint_key', ?)
     ON CONFLICT (name) DO NOTHING`,
    [crypto.randomUUID() + crypto.randomUUID()],
  )
  const { rows } = await client.execute(
    `SELECT value FROM ${t.installation} WHERE name = 'fingerprint_key'`,
  )
  return String(rows[0].value)
}

/**
 * Claims a once-per-installation step, such as applying the manifest's
 * bootstrap block: true for exactly one caller, ever.
 */
export async function claimOnce(
  client: SqlClient,
  step: string,
): Promise<boolean> {
  const t = tables(client)
  const { changes } = await client.execute(
    `INSERT INTO ${t.installation} (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO NOTHING`,
    [`done:${step}`, new Date().toISOString()],
  )
  return changes === 1
}

/** Whether a once-per-installation step has been claimed. */
export async function isDone(
  client: SqlClient,
  step: string,
): Promise<boolean> {
  const t = tables(client)
  const { rows } = await client.execute(
    `SELECT name FROM ${t.installation} WHERE name = ?`,
    [`done:${step}`],
  )
  return rows.length > 0
}

/** One audited action, as recorded. */
export interface AuditEntry {
  readonly id: number
  readonly at: string
  readonly actor: string
  readonly action: string
  readonly target?: string
  readonly revision?: string
  readonly outcome: string
  readonly details: Record<string, unknown>
}

/** Append-only: entries are added and read, never changed or removed. */
export class SqlAuditLog {
  private readonly t: ReturnType<typeof tables>

  constructor(private readonly client: SqlClient) {
    this.t = tables(client)
  }

  async record(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
    await this.client.execute(
      `INSERT INTO ${this.t.audit}
         (at, actor, action, target, revision, outcome, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.revision ?? null,
        entry.outcome,
        JSON.stringify(entry.details),
      ],
    )
  }

  /** Newest first. */
  async list(query: {
    limit: number
    before?: number
    actor?: string
    target?: string
  }): Promise<AuditEntry[]> {
    const where: string[] = []
    const params: (string | number)[] = []
    if (query.before !== undefined) {
      where.push('seq < ?')
      params.push(query.before)
    }
    if (query.actor !== undefined) {
      where.push('actor = ?')
      params.push(query.actor)
    }
    if (query.target !== undefined) {
      where.push('target = ?')
      params.push(query.target)
    }
    const { rows } = await this.client.execute(
      `SELECT * FROM ${this.t.audit}
       ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
       ORDER BY seq DESC LIMIT ${Math.trunc(query.limit)}`,
      params,
    )
    return rows.map((row) => ({
      id: Number(row.seq),
      at: String(row.at),
      actor: String(row.actor),
      action: String(row.action),
      ...(row.target === null ? {} : { target: String(row.target) }),
      ...(row.revision === null ? {} : { revision: String(row.revision) }),
      outcome: String(row.outcome),
      details: JSON.parse(String(row.details)),
    }))
  }
}

export class SqlRevisionStore implements RevisionStore {
  private readonly t: ReturnType<typeof tables>

  constructor(private readonly client: SqlClient) {
    this.t = tables(client)
  }

  async active(): Promise<ActiveState | undefined> {
    const { rows } = await this.client.execute(
      `SELECT r.* FROM ${this.t.revisions} r
       JOIN ${this.t.state} s ON s.active_revision = r.id
       WHERE s.id = 1`,
    )
    return rows.length === 0 ? undefined : toState(rows[0])
  }

  async find(revisionId: string): Promise<ActiveState | undefined> {
    const { rows } = await this.client.execute(
      `SELECT * FROM ${this.t.revisions} WHERE id = ?`,
      [revisionId],
    )
    return rows.length === 0 ? undefined : toState(rows[0])
  }

  async history(limit = 50): Promise<Revision[]> {
    const { rows } = await this.client.execute(
      `SELECT * FROM ${this.t.revisions} ORDER BY seq DESC LIMIT ${
        Math.trunc(limit)
      }`,
    )
    return rows.map((row) => toState(row).revision)
  }

  async activate(
    state: ActiveState,
    expectedActive: string | undefined,
  ): Promise<void> {
    const { revision } = state
    await this.client.execute(
      `INSERT INTO ${this.t.revisions}
         (id, parent, manifest, author, reason, created_at, resolved, fingerprints, authored)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        revision.id,
        revision.parent ?? null,
        revision.manifest,
        revision.author,
        revision.reason ?? null,
        revision.createdAt.toISOString(),
        JSON.stringify(state.resolved),
        JSON.stringify(state.fingerprints),
        state.authored === undefined ? null : JSON.stringify(state.authored),
      ],
    )
    // Compare-and-swap: only moves the pointer if nobody else has.
    const swapped = expectedActive === undefined
      ? await this.client.execute(
        `UPDATE ${this.t.state} SET active_revision = ?
         WHERE id = 1 AND active_revision IS NULL`,
        [revision.id],
      )
      : await this.client.execute(
        `UPDATE ${this.t.state} SET active_revision = ?
         WHERE id = 1 AND active_revision = ?`,
        [revision.id, expectedActive],
      )
    if (swapped.changes !== 1) {
      // Lost the race: the revision never went live, so it is not history.
      await this.client.execute(
        `DELETE FROM ${this.t.revisions} WHERE id = ?`,
        [
          revision.id,
        ],
      )
      throw new StaleBaseError()
    }
  }
}

function toState(row: Record<string, unknown>): ActiveState {
  return {
    revision: Revision.create({
      id: String(row.id),
      parent: row.parent === null ? undefined : String(row.parent),
      manifest: String(row.manifest) as `sha256:${string}`,
      author: String(row.author),
      reason: row.reason === null ? undefined : String(row.reason),
      createdAt: new Date(String(row.created_at)),
    }),
    resolved: JSON.parse(String(row.resolved)) as ResolvedManifest,
    fingerprints: JSON.parse(String(row.fingerprints)) as SecretFingerprints,
    authored: row.authored === null || row.authored === undefined
      ? undefined
      : (JSON.parse(String(row.authored)) as Json),
  }
}

export interface LockOptions {
  /** A holder that stops renewing loses the lock after this long. */
  ttlMs?: number
  now?: () => number
}

/**
 * A lease in one row: taking it is an upsert that only succeeds when the row
 * is absent or expired, so two instances can't both hold it. The holder
 * renews while it works, and a crashed holder's lease simply runs out.
 */
export class SqlApplyLock implements ApplyLock {
  private readonly t: ReturnType<typeof tables>
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(private readonly client: SqlClient, options: LockOptions = {}) {
    this.t = tables(client)
    this.ttlMs = options.ttlMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  async acquire(owner: string): Promise<Lease | undefined> {
    const token = `${owner}:${crypto.randomUUID()}`
    const now = this.now()
    const taken = await this.client.execute(
      `INSERT INTO ${this.t.lock} (id, owner, expires_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
       WHERE ${this.t.lock}.expires_at < ?`,
      [token, now + this.ttlMs, now],
    )
    if (taken.changes !== 1) return undefined

    const renew = setInterval(() => {
      this.client.execute(
        `UPDATE ${this.t.lock} SET expires_at = ? WHERE id = 1 AND owner = ?`,
        [this.now() + this.ttlMs, token],
      ).catch(() => {})
    }, this.ttlMs / 3)
    return {
      release: async () => {
        clearInterval(renew)
        await this.client.execute(
          `DELETE FROM ${this.t.lock} WHERE id = 1 AND owner = ?`,
          [token],
        )
      },
    }
  }
}
