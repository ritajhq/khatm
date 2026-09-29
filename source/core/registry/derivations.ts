import {
  type Derivation,
  type Derived,
  landingApplication,
  type Manifest,
  SERVICE_USER,
} from '@khatm/spec'

/**
 * Trusted origins, the login page's `return_to` allowlist and its landing
 * app, all from the first-party applications, so an origin can't be trusted
 * in one place and forgotten in another.
 */
export const fromApplications: Derivation = {
  derive(manifest: Manifest): Record<string, Derived> {
    const origins = manifest.auth.applications.flatMap((app) =>
      app.kind === 'first-party' ? [app.origin] : []
    )
    if (origins.length === 0) return {}

    const derivedFrom = 'auth.applications'
    return {
      trustedOrigins: { value: origins, derivedFrom },
      'login.returnTo': { value: origins, derivedFrom },
      'login.landing': {
        value: landingApplication(manifest.auth.applications)!.origin,
        derivedFrom,
      },
    }
  },
}

/** Better Auth's cross-subdomain cookie, from the session contract's cookie domain. */
export const fromCookieDomain: Derivation = {
  derive(manifest: Manifest): Record<string, Derived> {
    const domain = manifest.auth.session.cookieDomain
    if (domain === undefined) return {}
    return {
      'advanced.crossSubDomainCookies': {
        value: { enabled: true, domain },
        derivedFrom: 'auth.session.cookieDomain',
      },
    }
  },
}

/**
 * The admin plugin, always: khatm administers identities through it, as its
 * service user, and the `role` claim is its column. Nothing in khatm checks a
 * user's role; idhn policies read it.
 */
export const fromAdministration: Derivation = {
  derive(): Record<string, Derived> {
    return {
      'plugins.admin': {
        value: {
          kind: 'admin',
          options: { adminUserIds: [SERVICE_USER.id] },
        },
        derivedFrom: 'khatm.administration',
      },
    }
  },
}
