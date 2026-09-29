import { assertEquals } from '@std/assert'
import { SwitchableProxy } from './proxy.ts'

function upstream(name: string, delayMs = 0) {
  const server = Deno.serve({
    port: 0,
    hostname: '127.0.0.1',
    onListen: () => {},
  }, async (request) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const url = new URL(request.url)
    return Response.json({
      name,
      path: url.pathname + url.search,
      method: request.method,
      body: request.body ? await request.text() : null,
      forwardedHost: request.headers.get('x-forwarded-host'),
      cookie: request.headers.get('cookie'),
    }, { headers: { 'set-cookie': `from=${name}`, location: '/elsewhere' } })
  })
  return { server, url: `http://127.0.0.1:${server.addr.port}` }
}

Deno.test('SwitchableProxy: answers 503 until an upstream is set', async () => {
  const proxy = new SwitchableProxy()
  const response = await proxy.handle(new Request('http://public.test/x'))
  assertEquals(response.status, 503)
  await response.body?.cancel()
})

Deno.test('SwitchableProxy: forwards method, path, query, body and headers', async () => {
  const a = upstream('a')
  const proxy = new SwitchableProxy()
  proxy.switchTo(a.url)
  const response = await proxy.handle(
    new Request('http://public.test/api/auth/sign-in?x=1', {
      method: 'POST',
      body: 'payload',
      headers: { cookie: 'session=abc' },
    }),
  )
  assertEquals(await response.json(), {
    name: 'a',
    path: '/api/auth/sign-in?x=1',
    method: 'POST',
    body: 'payload',
    forwardedHost: 'public.test',
    cookie: 'session=abc',
  })
  assertEquals(response.headers.get('set-cookie'), 'from=a')
  await a.server.shutdown()
})

Deno.test('SwitchableProxy: passes redirects through instead of following them', async () => {
  const redirecting = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen: () => {} },
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.test/' },
      }),
  )
  const proxy = new SwitchableProxy()
  proxy.switchTo(`http://127.0.0.1:${redirecting.addr.port}`)
  const response = await proxy.handle(new Request('http://public.test/go'))
  assertEquals(response.status, 302)
  assertEquals(response.headers.get('location'), 'https://elsewhere.test/')
  await redirecting.shutdown()
})

Deno.test('SwitchableProxy: a switch never cuts off a request already in flight', async () => {
  const slow = upstream('slow', 150)
  const fast = upstream('fast')
  const proxy = new SwitchableProxy()
  proxy.switchTo(slow.url)

  const before = proxy.handle(new Request('http://public.test/before'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  proxy.switchTo(fast.url)
  const after = await proxy.handle(new Request('http://public.test/after'))

  assertEquals((await after.json()).name, 'fast')
  assertEquals((await (await before).json()).name, 'slow')
  await slow.server.shutdown()
  await fast.server.shutdown()
})

Deno.test('SwitchableProxy: drain waits for the old upstream and then lets go', async () => {
  const slow = upstream('slow', 150)
  const proxy = new SwitchableProxy()
  proxy.switchTo(slow.url)

  const pending = proxy.handle(new Request('http://public.test/x'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  assertEquals(proxy.inFlightTo(slow.url), 1)

  const started = Date.now()
  const drained = proxy.drain(slow.url)
  const response = await pending
  await response.text()
  await drained
  assertEquals(proxy.inFlightTo(slow.url), 0)
  assertEquals(Date.now() - started >= 100, true)
  await slow.server.shutdown()
})

Deno.test('SwitchableProxy: drain gives up after its timeout', async () => {
  const slow = upstream('slow', 500)
  const proxy = new SwitchableProxy()
  proxy.switchTo(slow.url)
  const pending = proxy.handle(new Request('http://public.test/x'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  const started = Date.now()
  await proxy.drain(slow.url, 100)
  assertEquals(Date.now() - started < 400, true)
  await (await pending).body?.cancel()
  await slow.server.shutdown()
})

Deno.test('SwitchableProxy: 502 when the upstream is down', async () => {
  const proxy = new SwitchableProxy()
  proxy.switchTo('http://127.0.0.1:1')
  const response = await proxy.handle(new Request('http://public.test/x'))
  assertEquals(response.status, 502)
  assertEquals(proxy.inFlightTo('http://127.0.0.1:1'), 0)
  await response.body?.cancel()
})
