import { stringify } from '@std/yaml'
import type { ResolvedManifest } from '@khatm/spec'
import { procedures } from './procedures.ts'

/** A fact a policy can use, read from the procedure's JSON body. */
interface BodyFact {
  readonly field: string
  readonly as: string
}

/**
 * The facts each procedure hands the judge. Only what a policy could decide
 * on: which revision or user, which role, whether destruction was confirmed.
 * Whole manifests stay out, they are too large to reason about in a policy,
 * and so do passwords.
 */
const FACTS: Readonly<Record<string, readonly BodyFact[]>> = {
  'khatm.apply': [
    { field: 'confirmed', as: 'confirmed' },
    { field: 'reason', as: 'reason' },
  ],
  'khatm.rollback': [
    { field: 'revision', as: 'revision' },
    { field: 'confirmed', as: 'confirmed' },
  ],
  'khatm.export': [{ field: 'revision', as: 'revision' }],
  'khatm.manifest': [{ field: 'revision', as: 'revision' }],
  'users.get': [{ field: 'user', as: 'user' }],
  'users.create': [
    { field: 'email', as: 'email' },
    { field: 'role', as: 'role' },
  ],
  'users.ban': [{ field: 'user', as: 'user' }],
  'users.unban': [{ field: 'user', as: 'user' }],
  // The role, so a policy can let someone grant `user` but not `admin`.
  'users.setRole': [
    { field: 'user', as: 'user' },
    { field: 'role', as: 'role' },
  ],
  'users.verifyEmail': [{ field: 'user', as: 'user' }],
  'users.setPassword': [{ field: 'user', as: 'user' }],
  'users.remove': [
    { field: 'user', as: 'user' },
    { field: 'confirmed', as: 'confirmed' },
  ],
  'sessions.revoke': [
    { field: 'user', as: 'user' },
    { field: 'session', as: 'session' },
  ],
  'audit.list': [
    { field: 'actor', as: 'actor' },
    { field: 'target', as: 'target' },
  ],
}

/** Fields the caller must send; every other fact is optional. */
const REQUIRED: ReadonlySet<string> = new Set([
  'khatm.rollback:revision',
  'users.get:user',
  'users.create:email',
  'users.ban:user',
  'users.unban:user',
  'users.setRole:user',
  'users.setRole:role',
  'users.verifyEmail:user',
  'users.setPassword:user',
  'users.remove:user',
  'sessions.revoke:user',
])

/** Better Auth's session cookie name: `__Secure-` prefixed when served over https. */
export function sessionCookieName(baseURL: string): string {
  const name = 'better-auth.session_token'
  return baseURL.startsWith('https://') ? `__Secure-${name}` : name
}

function authentication(resolved: ResolvedManifest) {
  const { session, baseURL } = resolved.auth
  return [{
    scheme: 'session-cookie',
    session_url: session.introspectionURL,
    issuer: session.issuer,
    claims: [...session.claims],
    cookie: sessionCookieName(baseURL),
  }]
}

/**
 * The idhn guard manifest for the control API: one action per procedure,
 * matched on `POST /<procedure>`, with its facts read from the body. It is
 * generated from the contract, so a new procedure can't be left unguarded.
 * The policies deciding who may do what stay the consumer's.
 */
export function controlGuardManifest(resolved: ResolvedManifest) {
  return {
    id: 'khatm_control',
    protocol: 'http',
    authentication: authentication(resolved),
    actions: Object.values(procedures).map((procedure) => {
      const facts = FACTS[procedure.name] ?? []
      return {
        name: procedure.name,
        match: { method: 'POST', path: `/${procedure.name}` },
        ...(facts.length === 0 ? {} : {
          extract: facts.map((fact) => ({
            from: { property: 'body', using: fact.field, type: 'json' },
            as: fact.as,
            ...(REQUIRED.has(`${procedure.name}:${fact.field}`)
              ? {}
              : { optional: true }),
          })),
        }),
      }
    }),
  }
}

/**
 * The idhn guard manifest for the console: opening it is one action, and each
 * control call it relays is another, so a policy can let someone look without
 * letting them apply. The control API's own guard still checks every call.
 */
export function consoleGuardManifest(resolved: ResolvedManifest) {
  return {
    id: 'khatm_console',
    protocol: 'http',
    authentication: authentication(resolved),
    actions: [
      {
        name: 'console.relay',
        match: { method: 'POST', path: '/control/:procedure' },
        extract: [{
          from: { property: 'path', using: 'procedure' },
          as: 'procedure',
        }],
      },
      {
        name: 'console.visit',
        match: { method: ['GET', 'HEAD'], path: ['/', '/*rest'] },
      },
    ],
  }
}

export function toYaml(manifest: object): string {
  return stringify(manifest, { lineWidth: 100 })
}
