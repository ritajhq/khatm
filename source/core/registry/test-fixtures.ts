import {
  type Manifest,
  parseManifest,
  type PlacedManifest,
  Placement,
  type ResolvedManifest,
} from '@khatm/spec'
import { defaultRegistry } from './registry.ts'

/**
 * Portal on its feat/authorization branch, written as a khatm manifest:
 * the reference consumer the first registry is built for.
 */
export function portal(
  auth: Record<string, unknown> = {},
): Manifest {
  return parseManifest({
    auth: {
      baseURL: 'https://auth.ritaj.app',
      secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
      database: {
        dialect: 'postgres',
        url: { env: 'DATABASE_URL' },
        schema: 'auth',
      },
      emailAndPassword: { enabled: true },
      plugins: [{ kind: 'username' }],
      applications: [
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.ritaj.app',
          landing: true,
        },
        {
          kind: 'first-party',
          id: 'admin',
          origin: 'https://admin.ritaj.app',
        },
      ],
      session: {
        cookieDomain: 'ritaj.app',
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'portal',
        claims: ['username', 'email', 'name', 'emailVerified', 'role'],
      },
      ...auth,
    },
    bootstrap: {
      users: [{ email: 'admin@ritaj.app', name: 'Admin', role: 'admin' }],
    },
  })
}

/**
 * `resolved` placed in a deployment that sets no variables: fixtures write
 * every value out, so placing changes nothing, and the result can go where a
 * worker's would.
 */
export function placed(resolved: ResolvedManifest): PlacedManifest {
  return defaultRegistry().place(resolved, new Placement(() => undefined))
}
