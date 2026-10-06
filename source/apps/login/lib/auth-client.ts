import { createAuthClient } from 'better-auth/client'
import { usernameClient } from 'better-auth/client/plugins'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'

/**
 * The auth API and these pages are served from the same origin. The OAuth
 * client plugin sends this page's signed query along with sign-in and
 * sign-up, so when an OAuth app sent the user here, the server finishes its
 * authorization instead of a plain sign-in.
 */
export const authClient = createAuthClient({
  baseURL: globalThis.location?.origin,
  plugins: [usernameClient(), oauthProviderClient()],
})

/**
 * Goes on once signed in: to `returnTo`, unless Better Auth's client is
 * already redirecting. It follows a `{ redirect, url }` answer by itself,
 * which is how an OAuth app's callback comes back; navigating there as well
 * would spend the single-use code twice.
 */
export function continueAfterSignIn(data: unknown, returnTo: string): void {
  if ((data as { redirect?: unknown } | null)?.redirect === true) return
  globalThis.location.href = returnTo
}
