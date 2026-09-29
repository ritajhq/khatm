import { Button } from '@khatm-libs/ui'

const NAMES: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  microsoft: 'Microsoft',
  apple: 'Apple',
  discord: 'Discord',
  gitlab: 'GitLab',
}

/** Anything without a known name is shown as its id, capitalised. */
export function providerName(id: string): string {
  return NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

export function SocialButtons(
  { providers, onSelect }: {
    providers: string[]
    onSelect(provider: string): void
  },
) {
  return (
    <div data-khatm-part='social' className='grid gap-2'>
      {providers.map((provider) => (
        <Button
          data-khatm-part='provider'
          key={provider}
          type='button'
          variant='outline'
          onClick={() => onSelect(provider)}
        >
          {providerName(provider)}
        </Button>
      ))}
    </div>
  )
}
