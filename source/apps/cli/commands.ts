import { parseArgs } from 'node:util'
import { Client, ControlError } from '@khatm/client'
import type { PlanView, RevisionView } from '@khatm/contract'

export interface Io {
  out(line: string): void
  err(line: string): void
  readFile(path: string): Promise<string>
  env(name: string): string | undefined
}

export const denoIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readFile: (path) => Deno.readTextFile(path),
  env: (name) => Deno.env.get(name),
}

/** Exit codes: 0 done, 1 failed, 2 misuse, 3 needs the operator (confirmation or a manual step). */
export type ExitCode = 0 | 1 | 2 | 3

const USAGE = `khatm <command> [options]

Commands:
  plan <manifest.json>       Show what applying the manifest would change
  apply <manifest.json>      Apply it (--yes confirms destructive changes)
  rollback <revision>        Apply an earlier revision's manifest again (--yes)
  status                     Which revision is serving
  history                    Past revisions, newest first (--limit N)
  events                     Recent deployment events (--limit N)

Options:
  --socket <path>            Control socket (default $KHATM_SOCKET, else /run/khatm/control.sock)
  --reason <text>            Recorded with the revision
  --yes                      Confirm destructive changes
`

export async function run(
  argv: string[],
  io: Io = denoIo,
  connect: (socket: string) => Client = (socket) => new Client({ socket }),
): Promise<ExitCode> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        socket: { type: 'string' },
        reason: { type: 'string' },
        yes: { type: 'boolean', default: false },
        limit: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return 2
  }
  const [command, target] = parsed.positionals
  if (parsed.values.help || command === undefined) {
    io.out(USAGE)
    return command === undefined && !parsed.values.help ? 2 : 0
  }

  const needsTarget = ['plan', 'apply', 'rollback'].includes(command)
  if (needsTarget && target === undefined) {
    io.err(
      `khatm ${command}: missing ${
        command === 'rollback' ? 'revision' : 'manifest file'
      }`,
    )
    return 2
  }
  if (
    !['plan', 'apply', 'rollback', 'status', 'history', 'events'].includes(
      command,
    )
  ) {
    io.err(`Unknown command: ${command}\n\n${USAGE}`)
    return 2
  }
  const limit = parsed.values.limit === undefined
    ? undefined
    : Number(parsed.values.limit)
  if (limit !== undefined && !Number.isInteger(limit)) {
    io.err('--limit must be a whole number')
    return 2
  }

  const client = connect(
    parsed.values.socket ?? io.env('KHATM_SOCKET') ?? '/run/khatm/control.sock',
  )
  try {
    const { api } = client
    switch (command) {
      case 'plan': {
        printPlan(
          io,
          await api.plan({ manifest: await readManifest(io, target) }),
        )
        return 0
      }
      case 'apply': {
        const manifest = await readManifest(io, target)
        const plan = await api.plan({ manifest })
        printPlan(io, plan)
        if (plan.isEmpty && plan.base !== undefined) return 0
        if (plan.isBlocked) {
          io.err('Blocked: do the manual steps above, then plan again.')
          return 3
        }
        if (plan.needsConfirmation && !parsed.values.yes) {
          io.err('Destructive changes need confirmation: run again with --yes.')
          return 3
        }
        const result = await api.apply({
          manifest,
          base: plan.base,
          confirmed: parsed.values.yes,
          reason: parsed.values.reason,
        })
        io.out(`Applied revision ${result.revision.id}`)
        return 0
      }
      case 'rollback': {
        const result = await api.rollback({
          revision: target,
          confirmed: parsed.values.yes,
          reason: parsed.values.reason,
        })
        printPlan(io, result.plan)
        io.out(`Rolled back as revision ${result.revision.id}`)
        return 0
      }
      case 'status': {
        const { active } = await api.status({})
        io.out(active ? describe(active) : 'No revision applied yet')
        return 0
      }
      case 'history': {
        const { revisions } = await api.history({ limit })
        for (const revision of revisions) io.out(describe(revision))
        if (revisions.length === 0) io.out('No revisions yet')
        return 0
      }
      default: {
        const { events } = await api.events({ limit })
        for (const event of events) {
          io.out(`${event.at}  ${event.type}  ${JSON.stringify(event.data)}`)
        }
        return 0
      }
    }
  } catch (error) {
    return report(io, error)
  } finally {
    client.close()
  }
}

async function readManifest(
  io: Io,
  path: string,
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await io.readFile(path))
  } catch (error) {
    throw new ControlError({
      code: 'invalid_request',
      message: `Can't read ${path}: ${
        error instanceof Error ? error.message : error
      }`,
    }, 0)
  }
}

function describe(revision: RevisionView): string {
  const reason = revision.reason ? `  "${revision.reason}"` : ''
  return `${revision.id}  ${revision.createdAt}  ${revision.author}${reason}`
}

function printPlan(io: Io, plan: PlanView): void {
  if (plan.isEmpty) {
    io.out('No changes')
    return
  }
  io.out(`Plan against ${plan.base ?? 'a fresh install'}: ${plan.impact}`)
  for (const step of plan.steps) {
    const from = step.derivedFrom ? ` (from ${step.derivedFrom})` : ''
    io.out(
      `  ${step.impact.padEnd(11)} ${step.path || '(whole manifest)'}${from}`,
    )
    io.out(`              ${step.reason}`)
  }
}

function report(io: Io, error: unknown): ExitCode {
  if (error instanceof ControlError) {
    io.err(`${error.code}: ${error.message}`)
    for (const detail of error.body.details ?? []) io.err(`  ${detail}`)
    for (const step of error.body.steps ?? []) {
      io.err(`  ${step.impact} ${step.path}: ${step.reason}`)
    }
    return error.code === 'blocked' || error.code === 'confirmation_required'
      ? 3
      : 1
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : ''
    io.err(`Can't reach the orchestrator${cause}`)
    return 1
  }
  io.err(error instanceof Error ? error.message : String(error))
  return 1
}
