import { assertEquals } from '@std/assert'
import { defaultRegistry } from '@khatm/registry'
import { InvalidManifestError, parseManifest } from '@khatm/spec'
import {
  chooseLocale,
  DEFAULT_MESSAGES,
  hasSignInMethod,
  pageConfig,
  resolveMessages,
  safeReturnTo,
  themeCss,
} from './index.ts'

function resolved(auth: Record<string, unknown> = {}, branding = {}) {
  return defaultRegistry().resolve(parseManifest({
    auth: {
      baseURL: 'https://auth.example.com',
      secrets: [{ version: 1, value: { env: 'S' } }],
      database: { dialect: 'sqlite', url: { env: 'D' } },
      emailAndPassword: { enabled: true },
      plugins: [{ kind: 'username' }],
      applications: [
        {
          kind: 'first-party',
          id: 'admin',
          origin: 'https://admin.example.com',
        },
        {
          kind: 'first-party',
          id: 'dashboard',
          origin: 'https://dashboard.example.com',
          landing: true,
        },
        {
          kind: 'oauth',
          id: 'thirdparty',
          redirectUris: ['https://third.example.org/cb'],
          scopes: ['openid'],
          confidential: true,
        },
      ],
      session: {
        introspectionURL: 'http://auth:4100/api/auth/get-session',
        issuer: 'example',
        claims: ['email'],
      },
      ...auth,
    },
    branding,
  }))
}

Deno.test('pageConfig: shows what the auth spec turns on and nothing secret', () => {
  const config = pageConfig(resolved({
    socialProviders: {
      github: {
        clientId: { env: 'GH_ID' },
        clientSecret: { env: 'GH_SECRET' },
      },
    },
  }))
  assertEquals(config.username, true)
  assertEquals(config.socialProviders, ['github'])
  assertEquals(config.landing, 'https://dashboard.example.com')
  assertEquals(config.returnOrigins, [
    'https://admin.example.com',
    'https://dashboard.example.com',
  ])
  assertEquals(JSON.stringify(config).includes('GH_SECRET'), false)
  assertEquals(hasSignInMethod(config), true)
  assertEquals(
    hasSignInMethod(
      pageConfig(resolved({ emailAndPassword: { enabled: false } })),
    ),
    false,
  )
})

Deno.test("safeReturnTo: only the service's own apps, never an open redirect", () => {
  const config = pageConfig(resolved())
  const dashboard = 'https://dashboard.example.com'
  assertEquals(
    safeReturnTo('https://admin.example.com/users?x=1', config),
    'https://admin.example.com/users?x=1',
  )
  for (
    const attempt of [
      'https://evil.example.com/',
      'https://admin.example.com.evil.com/',
      'https://admin.example.com@evil.com/',
      'javascript:alert(1)',
      '//evil.com',
      'not a url',
      '',
      null,
    ]
  ) {
    assertEquals(safeReturnTo(attempt, config), dashboard, String(attempt))
  }
  assertEquals(
    safeReturnTo('https://x.test', { returnOrigins: [], landing: undefined }),
    '/',
  )
})

Deno.test('messages: branding overrides the defaults, by locale, ignoring unknown ids', () => {
  const overrides = {
    it: { 'signIn.title': 'Accedi', 'nonsense.id': 'never shown' },
    'it-CH': { 'signIn.submit': 'Entra' },
  }
  const italian = resolveMessages(overrides, 'it-CH')
  assertEquals(italian['signIn.title'], 'Accedi')
  assertEquals(italian['signIn.submit'], 'Entra')
  assertEquals(italian['signIn.password'], DEFAULT_MESSAGES['signIn.password'])
  assertEquals('nonsense.id' in italian, false)
  assertEquals(resolveMessages(overrides, 'en')['signIn.title'], 'Sign in')
  assertEquals(chooseLocale(['fr', 'it-IT', 'en'], overrides), 'it-IT')
  assertEquals(chooseLocale(['fr'], overrides), 'en')
})

Deno.test('themeCss: tokens become custom properties, and bad ones are refused at parse time', () => {
  assertEquals(
    themeCss({ primary: 'oklch(0.5 0.2 250)', 'card-foreground': '#111' }),
    ':root{--card-foreground:#111;--primary:oklch(0.5 0.2 250);}',
  )
  assertEquals(themeCss({}), '')
  assertEquals(themeCss({ 'x;y': '1', ok: 'red; } body { display:none' }), '')
  for (
    const value of [
      'url(https://evil/x)',
      'red;}',
      '/* c */',
      '@import x',
      '\\41',
    ]
  ) {
    let thrown = false
    try {
      resolved({}, { tokens: { primary: value } })
    } catch (error) {
      thrown = error instanceof InvalidManifestError
    }
    assertEquals(thrown, true, value)
  }
})
