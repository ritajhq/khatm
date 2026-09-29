import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { defaultRegistry } from '@khatm/registry'
import { createAuth } from '@khatm/auth'
import { digestOf, parseManifest, type ResolvedManifest } from '@khatm/spec'
import {
  buildBundle,
  type BundleInput,
  BundleMismatchError,
  verifyBundle,
} from './bundle.ts'

function authored(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      baseURL: 'https://auth.example.com',
      secrets: [
        { version: 2, value: { env: 'AUTH_SECRET_2' } },
        { version: 1, value: { env: 'AUTH_SECRET_1' } },
      ],
      database: { dialect: 'sqlite', url: { env: 'DATABASE' } },
      emailAndPassword: { enabled: true },
      plugins: [{ kind: 'username' }],
      applications: [
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.example.com',
        },
      ],
      session: {
        cookieDomain: 'example.com',
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'example',
        claims: ['email', 'username', 'role'],
      },
      ...overrides,
    },
    branding: { tokens: { primary: '#123456' }, messages: {} },
  }
}

const resolve = (input: unknown): ResolvedManifest =>
  defaultRegistry().resolve(parseManifest(input))

async function input(
  overrides: Partial<BundleInput> = {},
  manifest = authored(),
): Promise<BundleInput> {
  const resolved = resolve(manifest)
  return {
    revision: {
      id: 'rev-2',
      manifest: await digestOf(resolved),
      author: 'ali',
      createdAt: new Date('2026-09-29T00:00:00Z'),
    },
    resolved,
    fingerprints: { 'env:AUTH_SECRET_1': 'fp1', 'env:AUTH_SECRET_2': 'fp2' },
    authored: manifest,
    versions: { betterAuth: '1.7.6', registrySchema: 1 },
    ...overrides,
  }
}

Deno.test('buildBundle: the same input gives the same files, and they agree with each other', async () => {
  const a = await buildBundle(await input())
  const b = await buildBundle(await input())
  assertEquals(a, b)
  assertEquals(Object.keys(a), [
    '.env.example',
    'auth.ts',
    'branding/messages.json',
    'branding/tokens.json',
    'lock.json',
    'manifest.authored.json',
    'manifest.json',
    'plan.md',
    'revision.json',
    'secrets.required.json',
  ])
  assertEquals(await verifyBundle(a), [])
  assertEquals(JSON.parse(a['lock.json']).betterAuth, '1.7.6')
  assertEquals(JSON.parse(a['lock.json']).plugins, ['admin', 'username'])
  assertStringIncludes(a['.env.example'], 'AUTH_SECRET_2=')
  assertStringIncludes(a['plan.md'], 'First revision')
})

Deno.test('buildBundle: plan.md says what changed from the parent', async () => {
  const before = await input()
  const changed = authored({
    applications: [
      {
        kind: 'first-party',
        id: 'dashboard',
        origin: 'https://dashboard.example.com',
      },
      { kind: 'first-party', id: 'admin', origin: 'https://admin.example.com' },
    ],
  })
  const bundle = await buildBundle(
    await input({
      revision: {
        ...(await input(undefined, changed)).revision,
        parent: 'rev-1',
      },
      parent: { resolved: before.resolved, fingerprints: before.fingerprints },
    }, changed),
  )
  assertStringIncludes(
    bundle['plan.md'],
    'Changes from revision rev-1 (restart)',
  )
  assertStringIncludes(bundle['plan.md'], 'auth.applications[admin]')
})

Deno.test('verifyBundle: a tampered manifest no longer matches its revision', async () => {
  const bundle = await buildBundle(await input())
  const tampered = {
    ...bundle,
    'manifest.json': bundle['manifest.json'].replace('example', 'evil'),
  }
  assertEquals((await verifyBundle(tampered)).length, 1)
  const { 'lock.json': _, ...withoutLock } = bundle
  assertEquals(await verifyBundle(withoutLock), ['lock.json is missing'])
})

Deno.test('buildBundle: refuses a revision whose manifest digest is not the resolved manifest', async () => {
  const good = await input()
  await assertRejects(
    () =>
      buildBundle({
        ...good,
        revision: { ...good.revision, manifest: `sha256:${'0'.repeat(64)}` },
      }),
    BundleMismatchError,
  )
})

Deno.test('eject: auth.ts is plain Better Auth that builds what khatm would', async () => {
  const bundle = await buildBundle(await input())
  // Inside this package, so the ejected file resolves better-auth from its imports.
  const dir = Deno.makeTempDirSync({ dir: import.meta.dirname })
  const env = {
    AUTH_SECRET_1: 'secret-one-with-plenty-of-entropy-00000001',
    AUTH_SECRET_2: 'secret-two-with-plenty-of-entropy-00000002',
    DATABASE: `${dir}/db.sqlite`,
  }
  for (const [name, value] of Object.entries(env)) Deno.env.set(name, value)
  try {
    Deno.writeTextFileSync(`${dir}/auth.ts`, bundle['auth.ts'])
    const { auth: ejected } = await import(`${dir}/auth.ts`)
    const { auth: built, close } = createAuth(
      (await input()).resolved,
      {
        env: (n) => env[n as keyof typeof env],
        readFile: Deno.readTextFileSync,
      },
      { quiet: true },
    )
    const summary = (
      options: Record<string, unknown> & {
        baseURL?: unknown
        trustedOrigins?: unknown
        secrets?: unknown
        plugins?: { id: string }[]
        advanced?: { crossSubDomainCookies?: unknown }
      },
    ) => ({
      baseURL: options.baseURL,
      trustedOrigins: options.trustedOrigins,
      secrets: options.secrets,
      plugins: (options.plugins ?? []).map((p: { id: string }) => p.id).sort(),
      cookies: options.advanced?.crossSubDomainCookies,
    })
    assertEquals(summary(ejected.options), summary(built.options))
    assertEquals(ejected.options.secrets[0].version, 2)
    await close()
  } finally {
    for (const name of Object.keys(env)) Deno.env.delete(name)
    Deno.removeSync(dir, { recursive: true })
  }
})
