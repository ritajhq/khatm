import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@khatm-libs/ui'
import { type FormEvent, useState } from 'react'
import { safeReturnTo } from '@khatm/pages'
import { authClient, continueAfterSignIn } from '../lib/auth-client.ts'
import { usePage } from '../lib/context.tsx'
import { Layout } from '../components/layout.tsx'
import { Field } from '../components/field.tsx'

export function SignUp() {
  const { config, t } = usePage()
  const search = globalThis.location.search
  const returnTo = safeReturnTo(
    new URLSearchParams(search).get('return_to'),
    config,
  )
  const [message, setMessage] = useState<string | undefined>()
  const [failed, setFailed] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const fields = {
      name: String(form.get('name') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    }
    setBusy(true)
    setFailed(undefined)
    const { data, error } = await authClient.signUp.email(
      config.username
        ? { ...fields, username: String(form.get('username') ?? '').trim() }
        : fields,
    )
    setBusy(false)
    if (error) {
      setFailed(error.message || t('signUp.failed'))
      return
    }
    if (config.emailAndPassword.requireVerification) {
      setMessage(t('signUp.verify'))
      return
    }
    continueAfterSignIn(data, returnTo)
  }

  return (
    <Layout>
      <Card data-khatm-part='card'>
        <CardHeader data-khatm-part='header'>
          <CardTitle data-khatm-part='title'>{t('signUp.title')}</CardTitle>
          <CardDescription data-khatm-part='description'>
            {t('signUp.description')}
          </CardDescription>
        </CardHeader>
        <CardContent data-khatm-part='content' className='grid gap-4'>
          {failed && (
            <Alert data-khatm-part='alert' tone='destructive'>{failed}</Alert>
          )}
          {message && <Alert data-khatm-part='alert'>{message}</Alert>}
          {!message && (
            <form
              data-khatm-part='form'
              onSubmit={submit}
              className='grid gap-4'
            >
              <Field
                id='name'
                label={t('signUp.name')}
                autoComplete='name'
                required
              />
              {config.username && (
                <Field
                  id='username'
                  label={t('signUp.username')}
                  autoComplete='username'
                  required
                />
              )}
              <Field
                id='email'
                label={t('signUp.email')}
                type='email'
                autoComplete='email'
                required
              />
              <Field
                id='password'
                label={t('signUp.password')}
                type='password'
                autoComplete='new-password'
                minLength={8}
                required
              />
              <Button data-khatm-part='submit' type='submit' disabled={busy}>
                {busy ? t('signUp.submitting') : t('signUp.submit')}
              </Button>
            </form>
          )}
          <p data-khatm-part='switch' className='text-center text-sm'>
            {t('signUp.haveAccount')}{' '}
            <a
              href={`/login${search}`}
              className='underline underline-offset-4'
            >
              {t('signUp.toSignIn')}
            </a>
          </p>
        </CardContent>
      </Card>
    </Layout>
  )
}
