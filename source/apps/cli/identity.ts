import type { Client } from '@khatm/client'
import type { AuditEntryView, UserDetail, UserView } from '@khatm/contract'
import type { ExitCode, Io } from './commands.ts'

export const IDENTITY_USAGE = `
Users (a user is an id, or an email):
  users list                 Users, newest first (--search text, --field email|name, --limit, --offset)
  users show <user>          A user with their sessions and sign-in methods
  users create <email>       Create a user (--name, --role, --password-stdin)
  users ban <user>           Ban and sign out (--reason text, --expires seconds)
  users unban <user>
  users set-role <user> <role>
  users verify <user>        Mark the email as verified
  users set-password <user>  Set a password, read from stdin
  users remove <user>        Delete the user and everything linked (--yes)
  sessions revoke <user>     Sign the user out everywhere, or one session (--session id)
  audit                      Who did what, newest first (--limit, --actor, --target)
`

export interface IdentityOptions {
  search?: string
  field?: string
  limit?: number
  offset?: number
  name?: string
  role?: string
  reason?: string
  expires?: string
  session?: string
  actor?: string
  target?: string
  yes: boolean
  'password-stdin': boolean
}

type Api = Client['api']

/** `users …`, `sessions …` and `audit`; `undefined` when the command is none of them. */
export async function runIdentity(
  words: string[],
  options: IdentityOptions,
  api: Api,
  io: Io,
): Promise<ExitCode | undefined> {
  const [command, action, user, extra] = words
  if (command === 'audit') {
    const { entries } = await api.audit({
      limit: options.limit,
      actor: options.actor,
      target: options.target,
    })
    for (const entry of entries) io.out(describeEntry(entry))
    if (entries.length === 0) io.out('Nothing audited yet')
    return 0
  }
  if (command === 'sessions') {
    if (action !== 'revoke' || !user) {
      io.err('khatm sessions revoke <user> [--session id]')
      return 2
    }
    const { revoked } = await api.revokeSessions({
      user,
      session: options.session,
    })
    io.out(`Revoked ${revoked} session${revoked === 1 ? '' : 's'}`)
    return 0
  }
  if (command !== 'users') return undefined

  if (action === 'list') {
    const field = options.field ?? 'email'
    if (field !== 'email' && field !== 'name') {
      io.err('--field must be email or name')
      return 2
    }
    const { users, total } = await api.listUsers({
      search: options.search,
      field,
      limit: options.limit,
      offset: options.offset,
    })
    for (const u of users) io.out(describeUser(u))
    io.out(`${users.length} of ${total}`)
    return 0
  }
  if (action === 'create') {
    if (!user || !options.name) {
      io.err('khatm users create <email> --name <name> [--role role]')
      return 2
    }
    const password = options['password-stdin']
      ? await readPassword(io)
      : undefined
    const { user: created } = await api.createUser({
      email: user,
      name: options.name,
      role: options.role,
      password,
    })
    io.out(describeUser(created))
    return 0
  }
  if (!user) {
    io.err(`khatm users ${action ?? '<action>'} <user>`)
    return 2
  }
  switch (action) {
    case 'show':
      printDetail(io, await api.getUser({ user }))
      return 0
    case 'ban': {
      const expires = options.expires === undefined
        ? undefined
        : Number(options.expires)
      if (
        expires !== undefined && !(Number.isInteger(expires) && expires > 0)
      ) {
        io.err('--expires must be a whole number of seconds')
        return 2
      }
      const result = await api.banUser({
        user,
        reason: options.reason,
        expiresInSeconds: expires,
      })
      io.out(describeUser(result.user))
      return 0
    }
    case 'unban':
      io.out(describeUser((await api.unbanUser({ user })).user))
      return 0
    case 'set-role':
      if (!extra) {
        io.err('khatm users set-role <user> <role>')
        return 2
      }
      io.out(describeUser((await api.setRole({ user, role: extra })).user))
      return 0
    case 'verify':
      io.out(describeUser((await api.verifyEmail({ user })).user))
      return 0
    case 'set-password': {
      const password = await readPassword(io)
      io.out(describeUser((await api.setPassword({ user, password })).user))
      return 0
    }
    case 'remove': {
      const { removed } = await api.removeUser({
        user,
        confirmed: options.yes,
      })
      io.out(`Removed ${removed}`)
      return 0
    }
  }
  io.err(`Unknown users action: ${action}`)
  return 2
}

async function readPassword(io: Io): Promise<string> {
  const password = (await io.readStdin()).replace(/\r?\n$/, '')
  if (password.length === 0) throw new Error('No password on stdin')
  return password
}

function describeUser(user: UserView): string {
  const role = user.role ? `  ${user.role}` : ''
  const banned = user.banned
    ? `  banned${user.banReason ? ` (${user.banReason})` : ''}`
    : ''
  return `${user.id}  ${user.email}  ${user.name}${role}${banned}`
}

function printDetail(io: Io, detail: UserDetail): void {
  const { user } = detail
  io.out(describeUser(user))
  if (user.username) io.out(`  username   ${user.username}`)
  io.out(`  verified   ${user.emailVerified ? 'yes' : 'no'}`)
  io.out(`  created    ${user.createdAt}`)
  if (user.banExpires) io.out(`  ban ends   ${user.banExpires}`)
  io.out(
    `  sign-in    ${
      detail.accounts
        .map((a) => a.providerId === 'credential' ? 'password' : a.providerId)
        .join(', ') || 'none'
    }`,
  )
  io.out(`  sessions   ${detail.sessions.length}`)
  for (const session of detail.sessions) {
    const agent = session.userAgent ? `  ${session.userAgent}` : ''
    io.out(
      `    ${session.id}  until ${session.expiresAt}  ${
        session.ipAddress ?? ''
      }${agent}`,
    )
  }
}

function describeEntry(entry: AuditEntryView): string {
  const target = entry.target ? ` ${entry.target}` : ''
  const outcome = entry.outcome === 'ok' ? '' : `  FAILED ${entry.outcome}`
  const details = Object.keys(entry.details).length === 0
    ? ''
    : `  ${JSON.stringify(entry.details)}`
  return `${entry.at}  ${entry.actor}  ${entry.action}${target}${outcome}${details}`
}
