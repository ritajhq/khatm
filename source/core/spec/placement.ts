import type { Application } from './application.ts'
import { type EnvRef, isEnvRef, type Placed } from './env-ref.ts'
import {
  type BootstrapSpec,
  InvalidManifestError,
  type Manifest,
  parseManifest,
} from './manifest.ts'

/** Reads a variable of the deployment's environment. */
export type EnvSource = (name: string) => string | undefined

/** One reference in a manifest, and what the environment holds for it: nothing when it isn't set. */
export interface Reading {
  readonly path: string
  readonly env: string
  readonly value: string | undefined
}

/**
 * A manifest placed in one deployment: every `EnvRef` read from that
 * deployment's environment, then the manifest parsed again, so the checks
 * that compare values — every origin inside the cookie domain, no origin
 * twice — run on what was read. It reports every problem at once, the way a
 * manifest does.
 */
export class Placement {
  constructor(private readonly source: EnvSource) {}

  /** Throws `UnplaceableManifestError` when a required reference reads nothing, or what it reads doesn't fit. */
  place(manifest: Manifest): Placed<Manifest> {
    const readings: Reading[] = []
    const placed = this.substitute(manifest, readings)
    const problems = readings
      .filter((reading) => reading.value === undefined)
      .map((reading) => `${reading.path}: ${reading.env} is not set`)
    if (problems.length > 0) throw new UnplaceableManifestError(problems)

    try {
      return parseManifest(placed) as Placed<Manifest>
    } catch (error) {
      if (!(error instanceof InvalidManifestError)) throw error
      throw new UnplaceableManifestError(error.problems)
    }
  }

  /** Every required reference `manifest` holds and what it reads here, set or not, without placing it. */
  readings(manifest: Manifest): Reading[] {
    const readings: Reading[] = []
    this.substitute(manifest, readings)
    return readings
  }

  /** The users to create here: one whose email reads nothing isn't. */
  bootstrap(bootstrap: BootstrapSpec): Placed<BootstrapSpec> {
    return {
      users: bootstrap.users.flatMap((user) => {
        const email = this.optional(user.email)
        return email === undefined ? [] : [{ ...user, email }]
      }),
    }
  }

  private substitute(manifest: Manifest, readings: Reading[]): Manifest {
    const { auth } = manifest
    const { session } = auth
    return {
      ...manifest,
      auth: {
        ...auth,
        baseURL: this.required(auth.baseURL, 'auth.baseURL', readings),
        applications: auth.applications.map((app, index) =>
          this.application(app, `auth.applications.${index}`, readings)
        ),
        session: {
          ...session,
          cookieDomain: session.cookieDomain === undefined
            ? undefined
            : this.required(
              session.cookieDomain,
              'auth.session.cookieDomain',
              readings,
            ),
          introspectionURL: this.required(
            session.introspectionURL,
            'auth.session.introspectionURL',
            readings,
          ),
        },
      },
      bootstrap: manifest.bootstrap && this.bootstrap(manifest.bootstrap),
    }
  }

  private application(
    app: Application,
    path: string,
    readings: Reading[],
  ): Application {
    if (app.kind === 'first-party') {
      return {
        ...app,
        origin: this.required(app.origin, `${path}.origin`, readings),
      }
    }
    return {
      ...app,
      redirectUris: app.redirectUris.map((uri, index) =>
        this.required(uri, `${path}.redirectUris.${index}`, readings)
      ),
    }
  }

  private required<T>(value: T | EnvRef, path: string, readings: Reading[]): T {
    if (!isEnvRef(value)) return value
    const read = this.optional(value)
    readings.push({ path, env: value.env, value: read as string | undefined })
    return (read ?? '') as T
  }

  private optional<T>(value: T | EnvRef): T | undefined {
    if (!isEnvRef(value)) return value
    const read = this.source(value.env)
    return read === undefined || read === '' ? undefined : read as T
  }
}

export class UnplaceableManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `The manifest doesn't fit this deployment:\n${
        problems.map((p) => `- ${p}`).join('\n')
      }`,
    )
  }
}
