import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@khatm-libs/ui'
import type { MessageId } from '@khatm/pages'
import { usePage } from '../lib/context.tsx'
import { Layout } from '../components/layout.tsx'

/** A page that only says something: an error, or that sign-in is turned off. */
export function Notice(
  { title, description, back }: {
    title: MessageId
    description: MessageId
    back?: boolean
  },
) {
  const { t } = usePage()
  const code = new URLSearchParams(globalThis.location.search).get('error')
  return (
    <Layout>
      <Card>
        <CardHeader>
          <CardTitle>{t(title)}</CardTitle>
          <CardDescription>{t(description)}</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {code && (
            <p className='text-center text-xs text-muted-foreground'>{code}</p>
          )}
          {back && (
            <Button
              variant='outline'
              onClick={() => (globalThis.location.href = '/login')}
            >
              {t('error.back')}
            </Button>
          )}
        </CardContent>
      </Card>
    </Layout>
  )
}
