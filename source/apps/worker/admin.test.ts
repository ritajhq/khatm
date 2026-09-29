import { assertEquals } from '@std/assert'
import {
  type Administration,
  AdminRejectedError,
  ProtectedUserError,
  UnknownUserError,
} from '@khatm/auth'
import { createAdminHandler } from './admin.ts'

const calls: unknown[][] = []
const admin = {
  setRole: (user: string, role: string) => {
    calls.push(['setRole', user, role])
    if (user === 'missing') return Promise.reject(new UnknownUserError(user))
    if (user === 'khatm-service') {
      return Promise.reject(new ProtectedUserError())
    }
    if (role === 'bad') return Promise.reject(new AdminRejectedError('No'))
    return Promise.resolve({ id: user, role })
  },
} as unknown as Administration

const handle = createAdminHandler(admin, 'the-token')

function call(path: string, body: unknown, token = 'the-token') {
  return handle(
    new Request(`http://127.0.0.1:1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  )
}

Deno.test('admin surface: only the orchestrator, only data-plane procedures', async () => {
  const wrongToken = await call('/users.setRole', { user: 'u', role: 'x' }, 'x')
  assertEquals(wrongToken.status, 401)
  await wrongToken.body?.cancel()
  const controlPlane = await call('/khatm.apply', { manifest: {} })
  assertEquals(controlPlane.status, 404)
  await controlPlane.body?.cancel()
  const invalid = await call('/users.setRole', { user: 'u' })
  assertEquals(invalid.status, 400)
  await invalid.body?.cancel()
  assertEquals(calls, [])
})

Deno.test('admin surface: runs the procedure and maps refusals to contract errors', async () => {
  const ok = await call('/users.setRole', { user: 'u-1', role: 'admin' })
  assertEquals(await ok.json(), { user: { id: 'u-1', role: 'admin' } })
  for (
    const [user, role, status, code] of [
      ['missing', 'admin', 404, 'unknown_user'],
      ['khatm-service', 'admin', 403, 'protected_user'],
      ['u-1', 'bad', 422, 'rejected'],
    ] as const
  ) {
    const response = await call('/users.setRole', { user, role })
    assertEquals(response.status, status)
    assertEquals((await response.json()).error.code, code)
  }
})
