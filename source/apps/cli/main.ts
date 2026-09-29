import { run } from './commands.ts'

if (import.meta.main) Deno.exit(await run(Deno.args))
