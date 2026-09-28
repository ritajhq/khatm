import type { z } from 'zod'

/**
 * What the registry knows about one Better Auth plugin kind. The factory
 * that builds the real plugin belongs to the worker, which is the only
 * place `better-auth` is imported.
 */
export interface PluginDefinition {
  readonly kind: string
  /** Validates the options an operator writes for this plugin. */
  readonly options: z.ZodType
  /** User fields the plugin adds, which the session contract may expose as claims. */
  readonly userFields: readonly string[]
  /**
   * False for plugins khatm only ever derives, such as `admin`: an operator
   * changes what it derives from instead of writing it.
   */
  readonly authorable: boolean
}
