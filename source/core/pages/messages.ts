/** Every string the hosted pages show, by id. Branding overrides them per locale. */
export const DEFAULT_MESSAGES = {
  'signIn.title': 'Sign in',
  'signIn.description': 'Enter your details to continue',
  'signIn.identifier': 'Email or username',
  'signIn.email': 'Email',
  'signIn.password': 'Password',
  'signIn.submit': 'Sign in',
  'signIn.submitting': 'Signing in…',
  'signIn.failed': 'Those details did not work. Check them and try again.',
  'signIn.noAccount': "Don't have an account?",
  'signIn.toSignUp': 'Sign up',
  'signIn.social': 'Or continue with',
  'signUp.title': 'Create an account',
  'signUp.description': 'It only takes a moment',
  'signUp.name': 'Name',
  'signUp.username': 'Username',
  'signUp.email': 'Email',
  'signUp.password': 'Password',
  'signUp.submit': 'Create account',
  'signUp.submitting': 'Creating account…',
  'signUp.failed': 'We could not create the account.',
  'signUp.haveAccount': 'Already have an account?',
  'signUp.toSignIn': 'Sign in',
  'signUp.verify': 'Check your email to verify your account, then sign in.',
  'error.title': 'Something went wrong',
  'error.description': 'The sign-in could not be completed.',
  'error.back': 'Back to sign in',
  'disabled.title': 'Sign-in is not available',
  'disabled.description': 'This service has no sign-in method turned on.',
} as const

export type MessageId = keyof typeof DEFAULT_MESSAGES

/**
 * The catalog for a locale: the defaults, overridden by the branding's
 * messages for the language (`it-IT` falls back to `it`).
 */
export function resolveMessages(
  overrides: Readonly<Record<string, Readonly<Record<string, string>>>>,
  locale: string,
): Record<MessageId, string> {
  const language = locale.split('-')[0]
  return {
    ...DEFAULT_MESSAGES,
    ...pick(overrides[language], DEFAULT_MESSAGES),
    ...pick(overrides[locale], DEFAULT_MESSAGES),
  }
}

/** Overrides for ids that don't exist are ignored, never shown. */
function pick(
  source: Readonly<Record<string, string>> | undefined,
  known: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source ?? {}).filter(([id]) => id in known),
  )
}

/** Picks the first of the browser's languages that the branding has messages for. */
export function chooseLocale(
  preferred: readonly string[],
  overrides: Readonly<Record<string, unknown>>,
): string {
  for (const locale of preferred) {
    if (locale in overrides || locale.split('-')[0] in overrides) return locale
  }
  return 'en'
}
