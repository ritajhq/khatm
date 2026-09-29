import { useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@khatm-libs/ui'
import {
  branding,
  type Checked,
  format,
  previewQuery,
  withBranding,
} from '../draft.ts'

const PAGES = ['login', 'signup', 'error'] as const

/** Branding edits with a live preview of the real login pages, rendered by this console, not the auth server. */
export function Branding(
  { checked, onChange }: { checked: Checked; onChange(text: string): void },
) {
  const [page, setPage] = useState<typeof PAGES[number]>('login')
  const [newToken, setNewToken] = useState('')
  if (!checked.ok) {
    return (
      <p className='text-sm text-muted-foreground'>
        Fix the manifest to edit branding.
      </p>
    )
  }
  const current = branding(checked.authored)
  const update = (next: typeof current) =>
    onChange(format(withBranding(checked.authored, next)))

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_1fr]'>
      <Card>
        <CardHeader className='text-left'>
          <CardTitle className='text-base'>Branding</CardTitle>
          <CardDescription>
            Tokens are CSS custom properties: primary, background, radius…
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor='brand-name'>Name</Label>
            <Input
              id='brand-name'
              value={current.name ?? ''}
              onChange={(e) =>
                update({
                  ...current,
                  name: e.currentTarget.value || undefined,
                })}
            />
          </div>
          {Object.entries(current.tokens).map(([name, value]) => (
            <div key={name} className='grid gap-2'>
              <Label htmlFor={`token-${name}`}>--{name}</Label>
              <div className='flex gap-2'>
                <Input
                  id={`token-${name}`}
                  value={value}
                  onChange={(e) =>
                    update({
                      ...current,
                      tokens: {
                        ...current.tokens,
                        [name]: e.currentTarget.value,
                      },
                    })}
                />
                <Button
                  variant='outline'
                  onClick={() => {
                    const { [name]: _, ...rest } = current.tokens
                    update({ ...current, tokens: rest })
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div className='flex gap-2'>
            <Input
              aria-label='New token name'
              placeholder='token name, e.g. primary'
              value={newToken}
              onChange={(e) => setNewToken(e.currentTarget.value.trim())}
            />
            <Button
              variant='outline'
              disabled={!newToken || newToken in current.tokens}
              onClick={() => {
                update({
                  ...current,
                  tokens: { ...current.tokens, [newToken]: 'black' },
                })
                setNewToken('')
              }}
            >
              Add token
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='text-left'>
          <CardTitle className='text-base'>Preview</CardTitle>
          <div className='flex gap-2'>
            {PAGES.map((p) => (
              <Button
                key={p}
                size='sm'
                variant={p === page ? 'default' : 'outline'}
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <iframe
            title='Login page preview'
            className='h-[36rem] w-full rounded-md border'
            src={`/preview/${page}?draft=${previewQuery(checked.resolved)}`}
          />
        </CardContent>
      </Card>
    </div>
  )
}
