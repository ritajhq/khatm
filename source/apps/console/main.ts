import { createConsoleHandler } from './server.ts'

/** One console instance. Stateless: run as many as needed behind one address. */
if (import.meta.main) {
  const controlUrl = Deno.env.get('KHATM_CONTROL_URL')
  if (!controlUrl) {
    console.error(
      'KHATM_CONTROL_URL must point at the control API (its idhn guard)',
    )
    Deno.exit(1)
  }
  const handler = await createConsoleHandler({
    dist: Deno.env.get('KHATM_CONSOLE_DIST') ??
      new URL('./dist', import.meta.url).pathname,
    loginDist: Deno.env.get('KHATM_LOGIN_DIST') ??
      new URL('../login/dist', import.meta.url).pathname,
    controlUrl,
  })
  Deno.serve({ port: Number(Deno.env.get('PORT') ?? '4200') }, handler)
}
