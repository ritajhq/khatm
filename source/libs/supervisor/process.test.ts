import { assertEquals, assertMatch } from '@std/assert'
import { freePort, ManagedProcess } from './process.ts'

const deno = Deno.execPath()

Deno.test('ManagedProcess: reports a process that exits on its own', async () => {
  const child = ManagedProcess.start({
    command: deno,
    args: ['eval', 'console.log("hello"); Deno.exit(3)'],
    label: 'test',
  })
  const status = await child.exited
  assertEquals(status.code, 3)
  assertEquals(status.requested, false)
  assertEquals(child.alive, false)
  assertMatch(child.output, /hello/)
})

Deno.test('ManagedProcess: hands stdin to the child and closes it', async () => {
  const child = ManagedProcess.start({
    command: deno,
    args: [
      'eval',
      'const t = await new Response(Deno.stdin.readable).text(); console.log("got:" + t)',
    ],
    stdin: '{"a":1}',
    label: 'test',
  })
  await child.exited
  assertMatch(child.output, /got:\{"a":1\}/)
})

Deno.test('ManagedProcess: stop asks politely and says it was asked', async () => {
  const child = ManagedProcess.start({
    command: deno,
    args: ['eval', 'setInterval(() => {}, 1000)'],
    label: 'test',
  })
  const status = await child.stop(5_000)
  assertEquals(status.requested, true)
  assertEquals(child.alive, false)
})

Deno.test('ManagedProcess: stop kills a child that ignores SIGTERM after the grace period', async () => {
  const child = ManagedProcess.start({
    command: deno,
    args: [
      'eval',
      'Deno.addSignalListener("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)',
    ],
    label: 'test',
  })
  while (!child.output.includes('ready')) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const status = await child.stop(200)
  assertEquals(status.signal, 'SIGKILL')
})

Deno.test('freePort: gives a port that can then be bound', () => {
  const port = freePort()
  const listener = Deno.listen({ hostname: '127.0.0.1', port })
  listener.close()
})
