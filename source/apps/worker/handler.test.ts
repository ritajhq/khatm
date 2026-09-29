import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'

const auth = {
  handler: (request: Request) =>
    Promise.resolve(new Response(new URL(request.url).pathname)),
}
const handle = createHandler(auth, { origins: ['https://app.example.com'] })
const call = (path: string, init?: RequestInit) =>
  handle(new Request(`http://127.0.0.1:1${path}`, init))

Deno.test('worker: answers a preflight for a trusted origin with credentials', async () => {
  const response = await call('/api/auth/get-session', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://app.example.com',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'x-custom',
    },
  })
  assertEquals(response.status, 204)
  assertEquals(
    response.headers.get('access-control-allow-origin'),
    'https://app.example.com',
  )
  assertEquals(response.headers.get('access-control-allow-credentials'), 'true')
  assertEquals(response.headers.get('access-control-allow-headers'), 'x-custom')
})

Deno.test('worker: gives an untrusted origin no CORS headers', async () => {
  const response = await call('/api/auth/get-session', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example.com' },
  })
  assertEquals(response.headers.get('access-control-allow-origin'), null)
})

Deno.test('worker: adds CORS headers to Better Auth answers for a trusted origin', async () => {
  const response = await call('/api/auth/ok', {
    headers: { origin: 'https://app.example.com' },
  })
  assertEquals(await response.text(), '/api/auth/ok')
  assertEquals(
    response.headers.get('access-control-allow-origin'),
    'https://app.example.com',
  )
})

Deno.test('worker: only serves /api/auth', async () => {
  assertEquals((await call('/elsewhere')).status, 404)
  assertEquals((await call('/api/authx')).status, 404)
})
