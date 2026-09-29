import {
  type Administration,
  AdminRejectedError,
  ProtectedUserError,
  UnknownUserError,
} from '@khatm/auth'
import { type ErrorCode, identityProcedures, STATUS } from '@khatm/contract'

type Input = Record<string, never>

/**
 * The worker's internal admin surface: the data-plane procedures, run
 * through Better Auth as khatm's service user. It listens on its own
 * loopback port that the proxy never forwards to, and only the orchestrator
 * holds the token. The orchestrator has already authenticated and audited
 * the person asking.
 */
export function createAdminHandler(
  admin: Administration,
  token: string,
): (request: Request) => Promise<Response> {
  const expected = new TextEncoder().encode(`Bearer ${token}`)

  const run = (name: string, i: Input): Promise<unknown> => {
    switch (name) {
      case 'users.list':
        return admin.list(i)
      case 'users.lookup':
        return admin.lookup(i.ids).then((users) => ({ users }))
      case 'users.get':
        return admin.get(i.user)
      case 'users.create':
        return admin.create(i as never).then((user) => ({ user }))
      case 'users.ban':
        return admin.ban(i.user, i).then((user) => ({ user }))
      case 'users.unban':
        return admin.unban(i.user).then((user) => ({ user }))
      case 'users.setRole':
        return admin.setRole(i.user, i.role).then((user) => ({ user }))
      case 'users.verifyEmail':
        return admin.verifyEmail(i.user).then((user) => ({ user }))
      case 'users.setPassword':
        return admin.setPassword(i.user, i.password).then((user) => ({ user }))
      case 'users.remove':
        return admin.remove(i.user).then((removed) => ({ removed }))
      case 'sessions.revoke':
        return admin.revokeSessions(i.user, i.session).then((revoked) => ({
          revoked,
        }))
    }
    throw new Error(`No admin procedure ${name}`)
  }

  return async (request) => {
    const presented = new TextEncoder().encode(
      request.headers.get('authorization') ?? '',
    )
    if (!sameBytes(presented, expected)) {
      return failure('unauthenticated', 'Not the orchestrator')
    }
    const name = new URL(request.url).pathname.slice(1)
    const procedure = identityProcedures.find((p) => p.name === name)
    if (request.method !== 'POST' || !procedure) {
      return failure('unknown_procedure', `No admin procedure ${name}`)
    }
    const input = procedure.input.safeParse(
      await request.json().catch(() => undefined),
    )
    if (!input.success) {
      return failure('invalid_request', 'Invalid request')
    }
    try {
      return Response.json(await run(name, input.data as Input))
    } catch (error) {
      if (error instanceof UnknownUserError) {
        return failure('unknown_user', error.message)
      }
      if (error instanceof ProtectedUserError) {
        return failure('protected_user', error.message)
      }
      if (error instanceof AdminRejectedError) {
        return failure('rejected', error.message)
      }
      console.error(error)
      return failure(
        'internal',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

function failure(code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: STATUS[code] })
}

/** Compares without stopping at the first difference, so timing says nothing. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length
  for (let i = 0; i < b.length; i++) difference |= (a[i] ?? 0) ^ b[i]
  return difference === 0
}
