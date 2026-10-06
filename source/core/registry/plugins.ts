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
 * Better Auth's `admin` plugin. khatm always derives it, since identity
 * administration runs through it, and it adds the `role` column.
 * Authorization stays with idhn: nothing in khatm checks the role.
 */
export const admin: PluginDefinition = {
  kind: 'admin',
  options: z.object({}).strict(),
  userFields: ['role', 'banned', 'banReason', 'banExpires'],
  authorable: false,
}

/**
 * Better Auth's `jwt` plugin: the keys OAuth tokens are signed with, and the
 * JWKS endpoint clients verify them against. Derived whenever an OAuth
 * application is declared.
 */
export const jwt: PluginDefinition = {
  kind: 'jwt',
  options: z.object({}).strict(),
  userFields: [],
  authorable: false,
}

/** The scopes khatm's OAuth provider serves; an OAuth application may ask for these only. */
export const OAUTH_SCOPES: readonly string[] = [
  'openid',
  'profile',
  'email',
  'offline_access',
]

/**
 * `@better-auth/oauth-provider`: khatm as an OAuth 2.1 / OpenID Connect
 * provider, so other services can offer "Login with …". Derived whenever an
 * OAuth application is declared; its clients come from those applications.
 */
export const oauthProvider: PluginDefinition = {
  kind: 'oauth-provider',
  options: z.object({
    loginPage: z.string(),
    consentPage: z.string(),
    scopes: z.array(z.string()),
  }).strict(),
  userFields: [],
  authorable: false,
}
