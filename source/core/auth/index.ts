export {
  type Auth,
  createAuth,
  type CreatedAuth,
  UnknownCapabilityError,
} from './create-auth.ts'
export {
  ensureSchema,
  type OpenDatabase,
  openDatabase,
  UnsupportedDialectError,
} from './database.ts'
export {
  type MigrationPlan,
  planMigrations,
  runMigrations,
} from './migrations.ts'
export { betterAuthVersion } from './version.ts'
export { buildPlugin, UnknownPluginError } from './plugins.ts'
export {
  fingerprint,
  fingerprintSecrets,
  processSecrets,
  resolveAllSecrets,
  resolveSecret,
  type SecretSource,
  tryResolveSecret,
  UnresolvedSecretsError,
} from './secrets.ts'
