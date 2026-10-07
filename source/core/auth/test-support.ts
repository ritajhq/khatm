import { defaultRegistry } from '@khatm/registry'
import { parseManifest, type PlacedManifest, Placement } from '@khatm/spec'
import type { Auth } from './create-auth.ts'
import type { SecretSource } from './secrets.ts'

export const BASE_URL = 'http://localhost:4100'

export function fakeSource(
  env: Record<string, string>,
  files: Record<string, string> = {},
): SecretSource {
  return {
    env: (name) => env[name],
    readFile: (path) => {
      if (path in files) return files[path]
      throw new Error(`No such file: ${path}`)
    },
  }
}

/** A resolved and placed single-host manifest over a SQLite file, with the given overrides on its auth spec. */
export function resolvedSqlite(
  overrides: Record<string, unknown> = {},
): PlacedManifest {
  const registry = defaultRegistry()
  return registry.place(
    registry.resolve(parseManifest({
      auth: {
        baseURL: BASE_URL,
        secrets: [{ version: 1, value: { env: 'AUTH_SECRET_1' } }],
        database: { dialect: 'sqlite', url: { env: 'DATABASE' } },
        emailAndPassword: { enabled: true },
        applications: [{
          kind: 'first-party',
          id: 'dashboard',
          origin: 'http://localhost:3000',
        }],
        session: {
          introspectionURL: 'http://localhost:4100/api/auth/get-session',
          issuer: 'test',
          claims: ['email', 'name'],
        },
        ...overrides,
      },
    })),
    new Placement(() => undefined),
  )
}

export function secretValues(database: string): Record<string, string> {
  return {
    DATABASE: database,
    AUTH_SECRET_1: 'first-secret-value-with-plenty-of-entropy-1',
    AUTH_SECRET_2: 'second-secret-value-with-plenty-of-entropy-2',
  }
}

/** Signs a user up and returns the session cookie as a `cookie` header value. */
export async function signUp(
  auth: Auth,
  email = 'ada@example.com',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({
        email,
        password: 'a-long-enough-password',
        name: 'Ada',
        ...extra,
      }),
    }),
  )
  if (response.status !== 200) {
    throw new Error(
      `Sign-up failed: ${response.status} ${await response.text()}`,
    )
  }
  await response.body?.cancel()
  return response.headers.getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

/** What `get-session` says for this cookie: the session's user, or null. */
export async function sessionOf(
  auth: Auth,
  cookie: string,
): Promise<{ user: { email: string } } | null> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } }),
  )
  return await response.json()
}
