import {
  Administration,
  createAuth,
  OAuthClients,
  OAuthDiscovery,
} from '@khatm/auth'
import { createAdminHandler } from './admin.ts'
import type { ResolvedManifest } from '@khatm/spec'
import { pageConfig } from '@khatm/pages'
import { createHandler } from './handler.ts'
import { loadPages } from './pages.ts'

/**
 * One Better Auth worker. The orchestrator writes the resolved manifest to
 * stdin and picks the ports; secrets come from this process's environment,
 * so their values never pass through the orchestrator's pipes.
 */
async function main(): Promise<void> {
  const raw = await new Response(Deno.stdin.readable).text()
  const resolved = JSON.parse(raw) as ResolvedManifest
  const port = Number(Deno.env.get('PORT'))
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be set to the port to listen on')
  }

  const { auth, close } = createAuth(resolved)
  const administration = new Administration(auth)
  await administration.ensureServiceUser()
  // OAuth clients are rows, not config: bring them in line with the
  // manifest before this worker takes any traffic.
  await new OAuthClients(auth).sync(resolved.auth.applications)
  const origins = (resolved.derived['trustedOrigins']?.value as
    | string[]
    | undefined) ?? []
  const dist = Deno.env.get('KHATM_LOGIN_DIST') ??
    new URL('../../artifacts/login', import.meta.url).pathname
  // Headless: the service's own apps own the pages, so there are none here.
  const pages = resolved.branding.pages === 'headless'
    ? undefined
    : await loadPages({
      dist,
      config: pageConfig(resolved),
      tokens: resolved.branding.tokens,
      parts: resolved.branding.parts,
    }).catch(() => {
      console.warn(
        `No login pages in ${dist}: run "deno task build" in apps/login`,
      )
      return undefined
    })
  const discovery = resolved.derived['plugins.oauth-provider']
    ? new OAuthDiscovery(auth)
    : undefined
  const server = Deno.serve(
    { port, hostname: '127.0.0.1', onListen: () => {} },
    createHandler(auth, { origins }, pages, discovery),
  )

  // The internal admin surface, on its own loopback port the proxy never
  // forwards to. Without a token from the orchestrator there is none.
  const adminPort = Number(Deno.env.get('ADMIN_PORT'))
  const adminToken = Deno.env.get('KHATM_ADMIN_TOKEN')
  const adminServer = adminToken && Number.isInteger(adminPort) && adminPort > 0
    ? Deno.serve(
      { port: adminPort, hostname: '127.0.0.1', onListen: () => {} },
      createAdminHandler(administration, adminToken),
    )
    : undefined

  const shutdown = async () => {
    await adminServer?.shutdown()
    await server.shutdown()
    await close()
    Deno.exit(0)
  }
  Deno.addSignalListener('SIGTERM', shutdown)
  Deno.addSignalListener('SIGINT', shutdown)
  console.log(`khatm worker listening on 127.0.0.1:${port}`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    Deno.exit(1)
  })
}
