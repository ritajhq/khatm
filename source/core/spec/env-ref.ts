import { z } from 'zod'

/**
 * A value the deployment supplies rather than the manifest: where it runs
 * (its base URL, its apps' origins, its cookie domain) or who it starts with.
 * The manifest names the environment variable, so one manifest — and one
 * digest — serves every environment, and `plan` never sees the values: they
 * only change with a redeploy, which restarts khatm and places the manifest
 * again (see `Placement`). Unlike a secret, its value may be shown.
 */
export const EnvRef = z.object({ env: z.string().min(1) }).strict().brand<
  'EnvRef'
>()
export type EnvRef = z.infer<typeof EnvRef>

/** `schema`, or a reference to the variable this deployment supplies it in. */
export function placeable<T extends z.ZodType>(schema: T) {
  return z.union([schema, EnvRef])
}

/** Whether a manifest value is a reference rather than the value itself. */
export function isEnvRef(value: unknown): value is EnvRef {
  return typeof value === 'object' && value !== null && 'env' in value
}

/** `T` once every `EnvRef` in it has been read. */
export type Placed<T> = T extends EnvRef ? never
  : T extends readonly (infer U)[] ? Placed<U>[]
  : T extends object ? { [K in keyof T]: Placed<T[K]> }
  : T
