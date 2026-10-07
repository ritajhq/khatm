import type { Application, OAuthApplication, Placed } from '@khatm/spec'
import { ClientSecretHash } from './client-secret.ts'
import type { Auth } from './create-auth.ts'
import { processSecrets, resolveSecret, type SecretSource } from './secrets.ts'

const MODEL = 'oauthClient'

/** The slice of Better Auth's database adapter the sync needs. */
interface Adapter {
  findMany<T>(query: { model: string }): Promise<T[]>
  create(
    query: { model: string; data: Record<string, unknown> },
  ): Promise<unknown>
  update(query: {
    model: string
    where: { field: string; value: string }[]
    update: Record<string, unknown>
  }): Promise<unknown>
  delete(query: {
    model: string
    where: { field: string; value: string }[]
  }): Promise<void>
}

interface StoredClient {
  clientId: string
}

/**
 * Keeps Better Auth's OAuth client table equal to the manifest's OAuth
 * applications. Better Auth keeps clients as rows rather than config, so a
 * worker runs this before it serves: clients the manifest declares are
 * created or brought up to date, and any other client is deleted. The
 * manifest is the only way to register a client; there is no dynamic
 * registration.
 */
export class OAuthClients {
  constructor(
    private readonly auth: Auth,
    private readonly source: SecretSource = processSecrets,
    private readonly secretHash: ClientSecretHash = new ClientSecretHash(),
  ) {}

  private get adapter(): Promise<Adapter> {
    return (this.auth.$context as unknown as Promise<{ adapter: Adapter }>)
      .then((context) => context.adapter)
  }

  async sync(applications: readonly Placed<Application>[]): Promise<void> {
    const declared = applications.filter((
      app,
    ): app is Placed<OAuthApplication> => app.kind === 'oauth')
    // Without an OAuth application the provider isn't installed, so there
    // is no client table to keep in step.
    if (declared.length === 0) return

    const adapter = await this.adapter
    const stored = new Set(
      (await adapter.findMany<StoredClient>({ model: MODEL }))
        .map((client) => client.clientId),
    )
    const now = new Date()

    for (const app of declared) {
      const row = await this.row(app, now)
      if (stored.has(app.id)) {
        await adapter.update({
          model: MODEL,
          where: [{ field: 'clientId', value: app.id }],
          update: row,
        })
        continue
      }
      await adapter.create({
        model: MODEL,
        data: { ...row, clientId: app.id, createdAt: now },
      })
    }

    const kept = new Set(declared.map((app) => app.id))
    for (const clientId of stored) {
      if (kept.has(clientId)) continue
      await adapter.delete({
        model: MODEL,
        where: [{ field: 'clientId', value: clientId }],
      })
    }
  }

  /** The client row an application describes. Consent is skipped for every client for now. */
  private async row(
    app: Placed<OAuthApplication>,
    now: Date,
  ): Promise<Record<string, unknown>> {
    return {
      name: app.id,
      clientSecret: app.clientSecret === undefined
        ? null
        : await this.secretHash.hash(
          resolveSecret(app.clientSecret, this.source),
        ),
      tokenEndpointAuthMethod: app.confidential
        ? 'client_secret_basic'
        : 'none',
      redirectUris: app.redirectUris,
      scopes: app.scopes,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      requirePKCE: true,
      skipConsent: true,
      disabled: false,
      updatedAt: now,
    }
  }
}
