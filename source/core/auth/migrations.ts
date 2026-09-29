import { getMigrations } from 'better-auth/db/migration'
import type { ResolvedManifest } from '@khatm/spec'
import { createAuth } from './create-auth.ts'
import { ensureSchema } from './database.ts'
import { processSecrets, resolveSecret, type SecretSource } from './secrets.ts'

/** What Better Auth's migrator would change, without changing it. */
export interface MigrationPlan {
  /** Tables it would create. */
  readonly created: string[]
  /** Columns it would add, per existing table. */
  readonly added: { table: string; fields: string[] }[]
  /** Changes it refuses to make on its own, such as a required column with no default. */
  readonly unsafe: string[]
}

/** Better Auth's migrator only ever adds, so this is what a plugin change costs. */
export async function planMigrations(
  resolved: ResolvedManifest,
  source: SecretSource = processSecrets,
): Promise<MigrationPlan> {
  const { auth, close } = createAuth(resolved, source, { quiet: true })
  try {
    const migrations = await getMigrations(auth.options, {
      throwOnUnsafe: false,
    })
    return {
      created: migrations.toBeCreated.map((table) => table.table),
      added: migrations.toBeAdded.map((table) => ({
        table: table.table,
        fields: Object.keys(table.fields),
      })),
      unsafe: [
        ...((migrations as { unsafeChanges?: string[] }).unsafeChanges ?? []),
      ],
    }
  } finally {
    await close()
  }
}

export async function runMigrations(
  resolved: ResolvedManifest,
  source: SecretSource = processSecrets,
): Promise<void> {
  await ensureSchema(
    resolved.auth.database,
    resolveSecret(resolved.auth.database.url, source),
  )
  const { auth, close } = createAuth(resolved, source, { quiet: true })
  try {
    const { runMigrations } = await getMigrations(auth.options)
    await runMigrations()
  } finally {
    await close()
  }
}
