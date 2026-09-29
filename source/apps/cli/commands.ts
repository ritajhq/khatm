import { parseArgs } from 'node:util'
import { Client, ControlError } from '@khatm/client'
import { verifyBundle } from '@khatm/bundle'
import {
  consoleGuardManifest,
  controlGuardManifest,
  toYaml,
} from '@khatm/contract/guard'
import { defaultRegistry } from '@khatm/registry'
import { parseManifest } from '@khatm/spec'
import type { PlanView, RevisionView } from '@khatm/contract'

export interface Io {
  out(line: string): void
  err(line: string): void
  readFile(path: string): Promise<string>
  env(name: string): string | undefined
  /** Writes a file, creating its directories. */
  writeFile(path: string, content: string): Promise<void>
  /** Every file under a directory, keyed by its path inside it. */
  readTree(dir: string): Promise<Record<string, string>>
}

export const denoIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readFile: (path) => Deno.readTextFile(path),
  env: (name) => Deno.env.get(name),
  async writeFile(path, content) {
    await Deno.mkdir(path.slice(0, path.lastIndexOf('/')) || '.', {
      recursive: true,
    })
    await Deno.writeTextFile(path, content)
  },
  async readTree(dir) {
    const files: Record<string, string> = {}
    const walk = async (relative: string) => {
      for await (const entry of Deno.readDir(`${dir}/${relative}`)) {
        const path = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isDirectory) await walk(path)
        else files[path] = await Deno.readTextFile(`${dir}/${path}`)
      }
    }
    await walk('')
    return files
  },
}

/** Exit codes: 0 done, 1 failed, 2 misuse, 3 needs the operator (confirmation or a manual step). */
export type ExitCode = 0 | 1 | 2 | 3

const USAGE = `khatm <command> [options]

Commands:
  plan <manifest.json>       Show what applying the manifest would change
  apply <manifest.json>      Apply it (--yes confirms destructive changes)
  rollback <revision>        Apply an earlier revision's manifest again (--yes)
  export [revision]          Write a revision's bundle to a directory (--out dir)
  import <dir>               Apply the manifest in an exported bundle (--yes)
  guard <control|console> <manifest.json>
                             Print the idhn guard manifest for that surface
  status                     Which revision is serving
  history                    Past revisions, newest first (--limit N)
  events                     Recent deployment events (--limit N)

Options:
  --socket <path>            Control socket (default $KHATM_SOCKET, else /run/khatm/control.sock)
  --reason <text>            Recorded with the revision
  --out <dir>                Where export writes (default ./khatm-<revision>)
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
        out: { type: 'string' },
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

  if (command === 'guard') {
    const [, surface, file] = parsed.positionals
    if ((surface !== 'control' && surface !== 'console') || !file) {
      io.err('khatm guard: give control or console, then a manifest file')
      return 2
    }
    try {
      const resolved = defaultRegistry().resolve(
        parseManifest(await readManifest(io, file)),
      )
      io.out(toYaml(
        surface === 'control'
          ? controlGuardManifest(resolved)
          : consoleGuardManifest(resolved),
      ))
      return 0
    } catch (error) {
      return report(io, error)
    }
  }

  const needsTarget = ['plan', 'apply', 'rollback', 'import'].includes(command)
  if (needsTarget && target === undefined) {
    io.err(
      `khatm ${command}: missing ${
        command === 'rollback'
          ? 'revision'
          : command === 'import'
          ? 'bundle directory'
          : 'manifest file'
      }`,
    )
    return 2
  }
  if (
    ![
      'plan',
      'apply',
      'rollback',
      'export',
      'import',
      'status',
      'history',
      'events',
    ].includes(command)
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
      case 'apply':
        return await applyManifest(
          io,
          api,
          await readManifest(io, target),
          parsed.values.yes,
          parsed.values.reason,
        )
      case 'import': {
        const files = await io.readTree(target)
        const problems = await verifyBundle(files)
        if (problems.length > 0) {
          io.err(`${target} is not an intact bundle:`)
          for (const problem of problems) io.err(`  ${problem}`)
          return 1
        }
        const authored = files['manifest.authored.json']
        if (authored === undefined) {
          io.err(`${target} has no manifest.authored.json to apply`)
          return 1
        }
        const from = JSON.parse(files['revision.json']).id
        return await applyManifest(
          io,
          api,
          JSON.parse(authored),
          parsed.values.yes,
          parsed.values.reason ?? `import of revision ${from}`,
        )
      }
      case 'export': {
        const { revision, files } = await api.export({ revision: target })
        const out = parsed.values.out ?? `./khatm-${revision.id}`
        for (const [path, content] of Object.entries(files)) {
          await io.writeFile(`${out}/${path}`, content)
        }
        io.out(`Wrote ${Object.keys(files).length} files to ${out}`)
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

async function applyManifest(
  io: Io,
  api: Client['api'],
  manifest: Record<string, unknown>,
  confirmed: boolean,
  reason: string | undefined,
): Promise<ExitCode> {
  const plan = await api.plan({ manifest })
  printPlan(io, plan)
  if (plan.isEmpty && plan.base !== undefined) return 0
  if (plan.isBlocked) {
    io.err('Blocked: do the manual steps above, then plan again.')
    return 3
  }
  if (plan.needsConfirmation && !confirmed) {
    io.err('Destructive changes need confirmation: run again with --yes.')
    return 3
  }
  const result = await api.apply({
    manifest,
    base: plan.base,
    confirmed,
    reason,
  })
  io.out(`Applied revision ${result.revision.id}`)
  return 0
}
