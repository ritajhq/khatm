import { z } from 'zod'

/**
 * A Better Auth plugin by its registry `kind`. The options' shape is the
 * registry's business, so here they are only a JSON object.
 */
export const PluginSpec = z.object({
  kind: z.string().min(1),
  options: z.record(z.string(), z.unknown()).default({}),
}).strict()
export type PluginSpec = z.infer<typeof PluginSpec>

export const PluginSpecs = z.array(PluginSpec).superRefine((plugins, ctx) => {
  const kinds = new Set<string>()
  for (const [index, plugin] of plugins.entries()) {
    if (kinds.has(plugin.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'kind'],
        message: `Plugin "${plugin.kind}" is declared twice`,
      })
    }
    kinds.add(plugin.kind)
  }
})

/**
 * A named behavior from the capability registry, standing in for a callback
 * `betterAuth()` would otherwise take as code.
 */
export const CapabilityRef = z.object({
  name: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
}).strict()
export type CapabilityRef = z.infer<typeof CapabilityRef>
