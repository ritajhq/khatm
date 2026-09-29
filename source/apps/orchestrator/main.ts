import { defaultRegistry } from '@khatm/registry'
import { parseManifest } from '@khatm/spec'
import { createRuntime, type Runtime } from './runtime.ts'

/**
 * Applies a manifest file, the way `KHATM_MANIFEST` does on start. Returns
 * a line saying what happened; throws when the plan needs an operator.
 */
export async function applyManifestFile(
  runtime: Runtime,
  path: string,
  options: { confirmed?: boolean } = {},
): Promise<string> {
  const manifest = parseManifest(JSON.parse(await Deno.readTextFile(path)))
  const resolved = defaultRegistry().resolve(manifest)
  const planned = await runtime.deployment.plan(resolved)
  if (planned.plan.isEmpty && runtime.deployment.activeRevision) {
    return 'manifest already applied'
  }
  const { revision } = await runtime.deployment.apply(planned, {
    author: 'file',
    reason: `manifest file ${path}`,
    confirmed: options.confirmed,
  })
  return `applied revision ${revision.id} (${planned.plan.impact})`
}

async function main(): Promise<void> {
  const store = Deno.env.get('KHATM_STORE')
  if (!store) {
    throw new Error(
      'KHATM_STORE must name the orchestrator database: postgres://… or a SQLite path',
    )
  }
  const port = Number(Deno.env.get('KHATM_PORT') ?? '4100')
  const runtime = await createRuntime({
    store,
    artifactsDirectory: Deno.env.get('KHATM_ARTIFACTS') ?? './khatm-artifacts',
    workerEntry: new URL('../worker/main.ts', import.meta.url).pathname,
    onEvent: (event) => console.log(JSON.stringify(event)),
  })

  const revision = await runtime.deployment.boot()
  console.log(
    revision ? `serving revision ${revision.id}` : 'no revision applied yet',
  )
  const manifest = Deno.env.get('KHATM_MANIFEST')
  if (manifest) {
    console.log(
      await applyManifestFile(runtime, manifest, {
        confirmed: Deno.env.get('KHATM_CONFIRM') === 'true',
      }),
    )
  }

  const server = runtime.proxy.serve({ port, hostname: '0.0.0.0' })
  const shutdown = async () => {
    await server.shutdown()
    await runtime.close()
    Deno.exit(0)
  }
  Deno.addSignalListener('SIGTERM', shutdown)
  Deno.addSignalListener('SIGINT', shutdown)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    Deno.exit(1)
  })
}
