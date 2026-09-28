import { z } from 'zod'
import type { PluginDefinition } from './plugin-definition.ts'

/** Fields Better Auth puts on every user. */
export const CORE_USER_FIELDS: readonly string[] = [
  'id',
  'name',
  'email',
  'emailVerified',
  'image',
  'createdAt',
  'updatedAt',
]

/** Better Auth's `username` plugin: sign-in by username as well as email. */
export const username: PluginDefinition = {
  kind: 'username',
  options: z.object({
    minUsernameLength: z.number().int().positive().optional(),
    maxUsernameLength: z.number().int().positive().optional(),
  }).strict(),
  userFields: ['username', 'displayUsername'],
  authorable: true,
}

/**
 * Better Auth's `admin` plugin. khatm derives it whenever the session
 * contract exposes `role`, since that column comes from it. Authorization
 * stays with idhn: nothing in khatm checks the role.
 */
export const admin: PluginDefinition = {
  kind: 'admin',
  options: z.object({}).strict(),
  userFields: ['role', 'banned', 'banReason', 'banExpires'],
  authorable: false,
}
