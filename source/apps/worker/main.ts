import { createAuth } from '@khatm/auth'
import type { ResolvedManifest } from '@khatm/spec'
import { pageConfig } from '@khatm/pages'
import { createHandler } from './handler.ts'
import { loadPages } from './pages.ts'

/**
 * One Better Auth worker. The orchestrator writes the resolved manifest to
 * stdin and picks the port; secrets come from this process's environment,
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
  const origins = (resolved.derived['trustedOrigins']?.value as
    | string[]
    | undefined) ?? []
  const dist = Deno.env.get('KHATM_LOGIN_DIST') ??
    new URL('../login/dist', import.meta.url).pathname
  const pages = await loadPages({
    dist,
    config: pageConfig(resolved),
    tokens: resolved.branding.tokens,
  }).catch(() => {
    console.warn(
      `No login pages in ${dist}: run "deno task build" in apps/login`,
    )
    return undefined
  })
  const server = Deno.serve(
    { port, hostname: '127.0.0.1', onListen: () => {} },
    createHandler(auth, { origins }, pages),
  )

  const shutdown = async () => {
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
