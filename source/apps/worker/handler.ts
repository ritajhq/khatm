import type { Auth } from '@khatm/auth'

/** Origins allowed to call the worker with credentials. */
export type Cors = { readonly origins: readonly string[] }

const METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'

/**
 * The worker's HTTP surface: Better Auth under `/api/auth`, CORS for the
 * manifest's trusted origins and nothing else. Better Auth doesn't answer
 * preflights itself, and the browser needs them for cross-origin sign-in.
 */
export function createHandler(
  auth: Pick<Auth, 'handler'>,
  cors: Cors,
): (request: Request) => Promise<Response> {
  const allowed = new Set(cors.origins)

  const withCors = (request: Request, response: Response): Response => {
    const origin = request.headers.get('origin')
    if (origin === null || !allowed.has(origin)) return response
    const headers = new Headers(response.headers)
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.append('vary', 'Origin')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname !== '/api/auth' && !pathname.startsWith('/api/auth/')) {
      return new Response('Not found', { status: 404 })
    }
    if (request.method === 'OPTIONS') {
      const headers = new Headers({ 'access-control-max-age': '600' })
      headers.set('access-control-allow-methods', METHODS)
      headers.set(
        'access-control-allow-headers',
        request.headers.get('access-control-request-headers') ??
          'content-type, authorization',
      )
      return withCors(request, new Response(null, { status: 204, headers }))
    }
    return withCors(request, await auth.handler(request))
  }
}
