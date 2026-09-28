import { z } from 'zod'
import { SecretRef } from './secret.ts'

/** Every dialect Better Auth's programmatic migrator supports. */
export const Dialect = z.enum(['postgres', 'mysql', 'sqlite', 'mssql'])
export type Dialect = z.infer<typeof Dialect>

export const DatabaseSpec = z.object({
  dialect: Dialect,
  url: SecretRef,
  /** Where Better Auth's tables live (`auth` in portal). Postgres and MSSQL only. */
  schema: z.string().min(1).optional(),
}).strict().superRefine((database, ctx) => {
  if (
    database.schema !== undefined &&
    database.dialect !== 'postgres' && database.dialect !== 'mssql'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['schema'],
      message: `${database.dialect} has no separate schemas`,
    })
  }
})
export type DatabaseSpec = z.infer<typeof DatabaseSpec>
