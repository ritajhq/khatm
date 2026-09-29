export {
  fromAdministration,
  fromApplications,
  fromCookieDomain,
} from './derivations.ts'
export type { PluginDefinition } from './plugin-definition.ts'
export { admin, CORE_USER_FIELDS, username } from './plugins.ts'
export {
  defaultRegistry,
  Registry,
  UnresolvableManifestError,
} from './registry.ts'

/** Bumped when the registry's schemas change shape, so a bundle's lock says what wrote it. */
export const REGISTRY_SCHEMA_VERSION = 1
export { type FormField, formFields } from './form.ts'
