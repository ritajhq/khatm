import { createAuthClient } from 'better-auth/client'
import { usernameClient } from 'better-auth/client/plugins'

/** The auth API and these pages are served from the same origin. */
export const authClient = createAuthClient({
  baseURL: globalThis.location?.origin,
  plugins: [usernameClient()],
})
