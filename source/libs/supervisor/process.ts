export interface ProcessSpec {
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  /** Written to the child's stdin, which is then closed. */
  readonly stdin?: string
  /** Prefixed to each line of the child's output as it is forwarded. */
  readonly label?: string
}

export interface ExitStatus {
  readonly code: number
  readonly signal: Deno.Signal | null
  /** True when `stop()` ended it, false when it exited on its own. */
  readonly requested: boolean
}

const TAIL_BYTES = 8 * 1024

/**
 * A child process with a lifecycle: started, watched for exit and stopped
 * politely (SIGTERM, then SIGKILL after a grace period). Keeps the tail of
 * its output so a failure can say what the child last printed.
 */
export class ManagedProcess {
  readonly exited: Promise<ExitStatus>
  private stopRequested = false
  private settled = false
  private tail = ''

  private constructor(
    private readonly child: Deno.ChildProcess,
    label: string,
  ) {
    this.exited = child.status.then((status) => {
      this.settled = true
      return {
        code: status.code,
        signal: status.signal,
        requested: this.stopRequested,
      }
    })
    void this.forward(child.stdout, label, Deno.stdout)
    void this.forward(child.stderr, label, Deno.stderr)
  }

  static start(spec: ProcessSpec): ManagedProcess {
    const child = new Deno.Command(spec.command, {
      args: [...(spec.args ?? [])],
      env: { ...spec.env },
      clearEnv: false,
      stdin: spec.stdin === undefined ? 'null' : 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()

    if (spec.stdin !== undefined) {
      const writer = child.stdin.getWriter()
      void writer
        .write(new TextEncoder().encode(spec.stdin))
        .then(() => writer.close())
        .catch(() => {})
    }
    return new ManagedProcess(child, spec.label ?? `pid ${child.pid}`)
  }

  get pid(): number {
    return this.child.pid
  }

  /** False once the child has exited, for whatever reason. */
  get alive(): boolean {
    return !this.settled
  }

  /** The last few KB the child printed, for diagnostics. */
  get output(): string {
    return this.tail
  }

  async stop(graceMs = 5_000): Promise<ExitStatus> {
    if (this.settled) return await this.exited
    this.stopRequested = true
    this.signal('SIGTERM')
    const timer = setTimeout(() => this.signal('SIGKILL'), graceMs)
    try {
      return await this.exited
    } finally {
      clearTimeout(timer)
    }
  }

  private signal(signal: Deno.Signal): void {
    try {
      this.child.kill(signal)
    } catch {
      // Already gone.
    }
  }

  private async forward(
    stream: ReadableStream<Uint8Array>,
    label: string,
    sink: { writeSync(bytes: Uint8Array): number },
  ): Promise<void> {
    const encoder = new TextEncoder()
    let pending = ''
    try {
      for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
        pending += chunk
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) this.emit(line, label, sink, encoder)
      }
      if (pending) this.emit(pending, label, sink, encoder)
    } catch {
      // The stream closed under us: the child is gone.
    }
  }

  private emit(
    line: string,
    label: string,
    sink: { writeSync(bytes: Uint8Array): number },
    encoder: TextEncoder,
  ): void {
    this.tail = (this.tail + line + '\n').slice(-TAIL_BYTES)
    try {
      sink.writeSync(encoder.encode(`[${label}] ${line}\n`))
    } catch {
      // Nowhere to log to.
    }
  }
}

/** A port nothing is listening on right now, for a child to bind. */
export function freePort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}
