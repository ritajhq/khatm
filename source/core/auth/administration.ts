import { SERVICE_USER } from '@khatm/spec'
import type { Auth } from './create-auth.ts'

/** A user as the control API shows it; see `UserView` in `@khatm/contract`. */
export interface AdminUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image?: string
  username?: string
  role?: string
  banned: boolean
  banReason?: string
  banExpires?: string
  createdAt: string
  updatedAt: string
}

export interface AdminSession {
  id: string
  createdAt: string
  expiresAt: string
  ipAddress?: string
  userAgent?: string
}

export interface AdminAccount {
  id: string
  providerId: string
  accountId: string
  createdAt: string
}

export class UnknownUserError extends Error {
  constructor(readonly ref: string) {
    super(`No user ${ref}`)
  }
}

/** khatm's own service user can't be changed, listed or removed through administration. */
export class ProtectedUserError extends Error {
  constructor() {
    super(`${SERVICE_USER.id} is khatm's service user and can't be changed`)
  }
}

/** Better Auth refused the change; its message says why. */
export class AdminRejectedError extends Error {}

type Row = Record<string, unknown>
type Call = (input: {
  headers: Headers
  body?: Row
  query?: Row
}) => Promise<unknown>

/** The admin plugin's server methods khatm uses. `Auth`'s type doesn't see plugin endpoints. */
interface AdminApi {
  listUsers: Call
  getUser: Call
  createUser: Call
  banUser: Call
  unbanUser: Call
  setRole: Call
  adminUpdateUser: Call
  setUserPassword: Call
  removeUser: Call
  listUserSessions: Call
  revokeUserSession: Call
  revokeUserSessions: Call
}

interface InternalAdapter {
  createUser(user: Row, source: Row): Promise<Row>
  findUserById(id: string): Promise<Row | null>
  findUserByEmail(email: string): Promise<{ user: Row } | null>
  findAccounts(userId: string): Promise<Row[]>
  createSession(
    userId: string,
    dontRememberMe?: boolean,
    override?: Row,
  ): Promise<{ token: string }>
  deleteSession(token: string): Promise<void>
}

interface AuthContext {
  secret: string
  internalAdapter: InternalAdapter
  authCookies: { sessionToken: { name: string } }
}

/** How long khatm's own session for one admin call may live. */
const SERVICE_SESSION_MS = 60_000

/**
 * Identity administration through Better Auth's admin plugin, so its hooks,
 * validation and cleanup run as for any admin. Each call runs as khatm's
 * service user with a session made for that call alone and deleted after.
 * Who asked is the caller's business to record; here it is always the
 * service user.
 */
export class Administration {
  constructor(private readonly auth: Auth) {}

  private get api(): AdminApi {
    return this.auth.api as unknown as AdminApi
  }

  private get context(): Promise<AuthContext> {
    return this.auth.$context as unknown as Promise<AuthContext>
  }

  /** Creates the service user unless it exists. It has no account, so no one can sign in as it. */
  async ensureServiceUser(): Promise<void> {
    const { internalAdapter } = await this.context
    if (await internalAdapter.findUserById(SERVICE_USER.id)) return
    try {
      await internalAdapter.createUser(
        { ...SERVICE_USER, emailVerified: true },
        { method: 'admin' },
      )
    } catch (error) {
      // Another worker made it first.
      if (!(await internalAdapter.findUserById(SERVICE_USER.id))) throw error
    }
  }

  async list(input: {
    search?: string
    field?: 'email' | 'name'
    limit?: number
    offset?: number
  }): Promise<{ users: AdminUser[]; total: number }> {
    const result = await this.call((api, headers) =>
      api.listUsers({
        headers,
        query: {
          ...(input.search === undefined ? {} : {
            searchValue: input.search,
            searchField: input.field ?? 'email',
            searchOperator: 'contains',
          }),
          filterField: 'id',
          filterOperator: 'ne',
          filterValue: SERVICE_USER.id,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          limit: input.limit ?? 50,
          offset: input.offset ?? 0,
        },
      })
    ) as { users: Row[]; total: number }
    return { users: result.users.map(toUser), total: result.total }
  }

  /** The users with these ids, in the order asked; unknown ids are left out. */
  async lookup(ids: readonly string[]): Promise<AdminUser[]> {
    const { internalAdapter } = await this.context
    const users: AdminUser[] = []
    for (const id of new Set(ids)) {
      if (id === SERVICE_USER.id) continue
      const row = await internalAdapter.findUserById(id)
      if (row) users.push(toUser(row))
    }
    return users
  }

  async get(ref: string): Promise<{
    user: AdminUser
    sessions: AdminSession[]
    accounts: AdminAccount[]
  }> {
    const id = await this.resolve(ref)
    const { internalAdapter } = await this.context
    const [user, sessions, accounts] = await Promise.all([
      this.call((api, headers) => api.getUser({ headers, query: { id } })),
      this.sessionsOf(id),
      internalAdapter.findAccounts(id),
    ])
    return {
      user: toUser(user as Row),
      sessions: sessions.map(toSession),
      accounts: accounts.map((account) => ({
        id: String(account.id),
        providerId: String(account.providerId),
        accountId: String(account.accountId),
        createdAt: iso(account.createdAt)!,
      })),
    }
  }

  async create(input: {
    email: string
    name: string
    password?: string
    role?: string
  }): Promise<AdminUser> {
    const { user } = await this.call((api, headers) =>
      api.createUser({ headers, body: { ...input } })
    ) as { user: Row }
    return toUser(user)
  }

  async ban(
    ref: string,
    input: { reason?: string; expiresInSeconds?: number },
  ): Promise<AdminUser> {
    const userId = await this.resolve(ref)
    const { user } = await this.call((api, headers) =>
      api.banUser({
        headers,
        body: {
          userId,
          ...(input.reason === undefined ? {} : { banReason: input.reason }),
          ...(input.expiresInSeconds === undefined
            ? {}
            : { banExpiresIn: input.expiresInSeconds }),
        },
      })
    ) as { user: Row }
    return toUser(user)
  }

  async unban(ref: string): Promise<AdminUser> {
    const userId = await this.resolve(ref)
    const { user } = await this.call((api, headers) =>
      api.unbanUser({ headers, body: { userId } })
    ) as { user: Row }
    return toUser(user)
  }

  async setRole(ref: string, role: string): Promise<AdminUser> {
    const userId = await this.resolve(ref)
    const { user } = await this.call((api, headers) =>
      api.setRole({ headers, body: { userId, role } })
    ) as { user: Row }
    return toUser(user)
  }

  async verifyEmail(ref: string): Promise<AdminUser> {
    const userId = await this.resolve(ref)
    const user = await this.call((api, headers) =>
      api.adminUpdateUser({
        headers,
        body: { userId, data: { emailVerified: true } },
      })
    ) as Row
    return toUser(user)
  }

  async setPassword(ref: string, password: string): Promise<AdminUser> {
    const userId = await this.resolve(ref)
    await this.call((api, headers) =>
      api.setUserPassword({
        headers,
        body: { userId, newPassword: password },
      })
    )
    return (await this.get(userId)).user
  }

  async remove(ref: string): Promise<string> {
    const userId = await this.resolve(ref)
    await this.call((api, headers) =>
      api.removeUser({ headers, body: { userId } })
    )
    return userId
  }

  /** Revokes one session by id, or all of the user's; returns how many. */
  async revokeSessions(ref: string, sessionId?: string): Promise<number> {
    const userId = await this.resolve(ref)
    const sessions = await this.sessionsOf(userId)
    if (sessionId === undefined) {
      await this.call((api, headers) =>
        api.revokeUserSessions({ headers, body: { userId } })
      )
      return sessions.length
    }
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return 0
    await this.call((api, headers) =>
      api.revokeUserSession({
        headers,
        body: { sessionToken: session.token },
      })
    )
    return 1
  }

  private async sessionsOf(userId: string): Promise<Row[]> {
    const { sessions } = await this.call((api, headers) =>
      api.listUserSessions({ headers, body: { userId } })
    ) as { sessions: Row[] }
    return sessions
  }

  /** A user id from an id or an email, refusing the service user. */
  private async resolve(ref: string): Promise<string> {
    const { internalAdapter } = await this.context
    const row = ref.includes('@')
      ? (await internalAdapter.findUserByEmail(ref.toLowerCase()))?.user
      : await internalAdapter.findUserById(ref)
    if (!row) throw new UnknownUserError(ref)
    if (row.id === SERVICE_USER.id) throw new ProtectedUserError()
    return String(row.id)
  }

  /** Runs one admin call as the service user, with a session that exists only for it. */
  private async call(
    run: (api: AdminApi, headers: Headers) => Promise<unknown>,
  ): Promise<unknown> {
    const context = await this.context
    const session = await context.internalAdapter.createSession(
      SERVICE_USER.id,
      true,
      { expiresAt: new Date(Date.now() + SERVICE_SESSION_MS) },
    )
    try {
      const cookie = `${context.authCookies.sessionToken.name}=${await sign(
        session.token,
        context.secret,
      )}`
      return await run(this.api, new Headers({ cookie }))
    } catch (error) {
      throw rejected(error)
    } finally {
      await context.internalAdapter.deleteSession(session.token)
    }
  }
}

/** Better Auth's signed cookie value: `token.base64(HMAC-SHA256(token))`, URL-encoded. */
async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
  )
  return encodeURIComponent(
    `${value}.${btoa(String.fromCharCode(...signature))}`,
  )
}

/** Better Auth's API errors carry a status and a message; anything else passes through. */
function rejected(error: unknown): unknown {
  if (
    error instanceof Error && 'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    if (error.statusCode === 404) return new UnknownUserError(error.message)
    return new AdminRejectedError(error.message)
  }
  return error
}

function iso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return new Date(value as string | Date).toISOString()
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined || value === ''
    ? undefined
    : String(value)
}

function toUser(row: Row): AdminUser {
  const user: AdminUser = {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    emailVerified: Boolean(row.emailVerified),
    banned: Boolean(row.banned),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  }
  const image = optional(row.image)
  const username = optional(row.username)
  const role = optional(row.role)
  const banReason = optional(row.banReason)
  const banExpires = iso(row.banExpires)
  if (image !== undefined) user.image = image
  if (username !== undefined) user.username = username
  if (role !== undefined) user.role = role
  if (banReason !== undefined) user.banReason = banReason
  if (banExpires !== undefined) user.banExpires = banExpires
  return user
}

function toSession(row: Row): AdminSession {
  const session: AdminSession = {
    id: String(row.id),
    createdAt: iso(row.createdAt)!,
    expiresAt: iso(row.expiresAt)!,
  }
  const ipAddress = optional(row.ipAddress)
  const userAgent = optional(row.userAgent)
  if (ipAddress !== undefined) session.ipAddress = ipAddress
  if (userAgent !== undefined) session.userAgent = userAgent
  return session
}
