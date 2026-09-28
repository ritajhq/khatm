import { type Manifest, parseManifest } from './manifest.ts'

/** A small valid authored manifest, before defaults; tests override what they need. */
export function authored(
  overrides: { auth?: Record<string, unknown>; [key: string]: unknown } = {},
): Record<string, unknown> {
  const { auth, ...rest } = overrides
  return {
    auth: {
      baseURL: 'https://auth.example.com',
      secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
      database: { dialect: 'postgres', url: { env: 'DATABASE_URL' } },
      emailAndPassword: { enabled: true },
      applications: [
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.example.com',
        },
      ],
      session: {
        cookieDomain: 'example.com',
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'example',
        claims: ['email', 'name'],
      },
      ...auth,
    },
    ...rest,
  }
}

export function manifest(
  overrides: Parameters<typeof authored>[0] = {},
): Manifest {
  return parseManifest(authored(overrides))
}
