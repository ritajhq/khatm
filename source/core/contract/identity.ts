import { z } from 'zod'

/**
 * The data plane: the people who use auth, as the control API shows them.
 * Session tokens and password hashes never leave the worker; sessions are
 * addressed by id.
 */
export const UserView = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  image: z.string().optional(),
  /** Present when the username plugin is installed and the user has one. */
  username: z.string().optional(),
  role: z.string().optional(),
  banned: z.boolean(),
  banReason: z.string().optional(),
  banExpires: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type UserView = z.infer<typeof UserView>

export const SessionView = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
})
export type SessionView = z.infer<typeof SessionView>

/** A sign-in method linked to a user: `credential` for a password, else the provider id. */
export const AccountView = z.object({
  id: z.string(),
  providerId: z.string(),
  accountId: z.string(),
  createdAt: z.string(),
})
export type AccountView = z.infer<typeof AccountView>

export const UserDetail = z.object({
  user: UserView,
  sessions: z.array(SessionView),
  accounts: z.array(AccountView),
})
export type UserDetail = z.infer<typeof UserDetail>

/** A user id, or an email when it contains `@`, so `grant-admin` style calls read naturally. */
export const UserRef = z.string().min(1)

/** One audited action: who did what to whom, and how it ended. */
export const AuditEntryView = z.object({
  id: z.number(),
  at: z.string(),
  /** idhn's subject for the caller, or `socket`, or `khatm` for its own actions. */
  actor: z.string(),
  action: z.string(),
  /** The user or revision acted on. */
  target: z.string().optional(),
  /** The revision the action produced or touched, when there is one. */
  revision: z.string().optional(),
  /** `ok`, or the error code it failed with. */
  outcome: z.string(),
  details: z.record(z.string(), z.unknown()),
})
export type AuditEntryView = z.infer<typeof AuditEntryView>
