import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider'
import type { Auth } from './create-auth.ts'

type Responder = (request: Request) => Promise<Response>

/**
 * The OAuth provider's discovery documents, which Better Auth leaves to the
 * host to serve. The issuer is `<baseURL>/api/auth`, so OpenID Connect
 * clients look under the issuer and OAuth clients under the root with the
 * issuer's path appended (RFC 8414).
 */
export class OAuthDiscovery {
  private readonly documents: ReadonlyMap<string, Responder>

  constructor(auth: Auth) {
    const api = auth as unknown as Parameters<
      typeof oauthProviderOpenIdConfigMetadata
    >[0]
    this.documents = new Map([
      [
        '/api/auth/.well-known/openid-configuration',
        oauthProviderOpenIdConfigMetadata(api),
      ],
      [
        '/.well-known/oauth-authorization-server/api/auth',
        oauthProviderAuthServerMetadata(
          api as unknown as Parameters<
            typeof oauthProviderAuthServerMetadata
          >[0],
        ),
      ],
    ])
  }

  /** The document this request asks for, or `undefined` when it asks for none. */
  respond(request: Request): Promise<Response> | undefined {
    if (request.method !== 'GET') return undefined
    return this.documents.get(new URL(request.url).pathname)?.(request)
  }
}
