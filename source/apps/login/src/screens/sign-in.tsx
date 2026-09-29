import { type FormEvent, useState } from 'react'
import { safeReturnTo } from '@khatm/pages'
import { authClient } from '../lib/auth-client.ts'
import { usePage } from '../lib/context.tsx'
import { Layout } from '../components/layout.tsx'
import { Field } from '../components/field.tsx'
import { SocialButtons } from '../components/social-buttons.tsx'
import { Alert } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.tsx'

export function SignIn() {
  const { config, t } = usePage()
  const search = globalThis.location.search
  const returnTo = safeReturnTo(
    new URLSearchParams(search).get('return_to'),
    config,
  )
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const identifier = String(form.get('identifier') ?? '').trim()
    const password = String(form.get('password') ?? '')
    setBusy(true)
    setFailed(false)
    const { error } = config.username && !identifier.includes('@')
      ? await authClient.signIn.username({ username: identifier, password })
      : await authClient.signIn.email({ email: identifier, password })
    if (error) {
      setFailed(true)
      setBusy(false)
      return
    }
    // The app it returns to is a separate origin: a hard navigation.
    globalThis.location.href = returnTo
  }

  return (
    <Layout>
      <Card>
        <CardHeader>
          <CardTitle>{t('signIn.title')}</CardTitle>
          <CardDescription>{t('signIn.description')}</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {failed && <Alert tone='destructive'>{t('signIn.failed')}</Alert>}
          {config.emailAndPassword.enabled && (
            <form onSubmit={submit} className='grid gap-4'>
              <Field
                id='identifier'
                label={config.username
                  ? t('signIn.identifier')
                  : t('signIn.email')}
                type={config.username ? 'text' : 'email'}
                autoComplete={config.username ? 'username' : 'email'}
                required
              />
              <Field
                id='password'
                label={t('signIn.password')}
                type='password'
                autoComplete='current-password'
                required
              />
              <Button type='submit' disabled={busy}>
                {busy ? t('signIn.submitting') : t('signIn.submit')}
              </Button>
            </form>
          )}
          {config.socialProviders.length > 0 && (
            <>
              {config.emailAndPassword.enabled && (
                <p className='text-center text-sm text-muted-foreground'>
                  {t('signIn.social')}
                </p>
              )}
              <SocialButtons
                providers={config.socialProviders}
                onSelect={(provider) =>
                  authClient.signIn.social({ provider, callbackURL: returnTo })}
              />
            </>
          )}
          {config.emailAndPassword.enabled && (
            <p className='text-center text-sm'>
              {t('signIn.noAccount')}{' '}
              <a
                href={`/signup${search}`}
                className='underline underline-offset-4'
              >
                {t('signIn.toSignUp')}
              </a>
            </p>
          )}
        </CardContent>
      </Card>
    </Layout>
  )
}
