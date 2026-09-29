import { useState } from 'react'
import {
  PART_NAMES,
  sanitizeSlot,
  SLOT_NAMES,
  type SlotName,
} from '@khatm/spec'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@khatm-libs/ui'
import {
  branding,
  type Checked,
  format,
  previewQuery,
  withBranding,
} from '../draft.ts'

const PAGES = ['login', 'signup', 'error'] as const

/** Slots are edited in English; other locales go in the manifest JSON. */
const SLOT_LOCALE = 'en'

/** Branding edits with a live preview of the real login pages, rendered by this console, not the auth server. */
export function Branding(
  { checked, onChange }: { checked: Checked; onChange(text: string): void },
) {
  const [page, setPage] = useState<typeof PAGES[number]>('login')
  const [newToken, setNewToken] = useState('')
  const [newPart, setNewPart] = useState<string>(PART_NAMES[0])
  const [newProperty, setNewProperty] = useState('')
  // A draft that doesn't resolve stays editable here, so a half-typed slot
  // doesn't take the editor away; the plan bar lists what is wrong.
  const authored = checked.authored
  if (!authored) {
    return (
      <p className='text-sm text-muted-foreground'>
        Fix the manifest to edit branding.
      </p>
    )
  }
  const current = branding(authored)
  const update = (next: typeof current) =>
    onChange(format(withBranding(authored, next)))
  const slots = current.slots[SLOT_LOCALE] ?? {}
  const setSlot = (name: SlotName, html: string) => {
    const { [name]: _, ...others } = slots
    update({
      ...current,
      slots: {
        ...current.slots,
        [SLOT_LOCALE]: html ? { ...others, [name]: html } : others,
      },
    })
  }
  const setDeclaration = (
    part: string,
    property: string,
    value: string | undefined,
  ) => {
    const { [property]: _, ...others } = current.parts[part] ?? {}
    update({
      ...current,
      parts: {
        ...current.parts,
        [part]: value === undefined ? others : { ...others, [property]: value },
      },
    })
  }
  const headless = current.pages === 'headless'

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

          <label className='flex items-center gap-2 border-t pt-4 text-sm'>
            <input
              type='checkbox'
              checked={headless}
              onChange={(e) =>
                update({
                  ...current,
                  pages: e.currentTarget.checked ? 'headless' : 'hosted',
                })}
            />
            Headless: serve no pages, our apps build their own
          </label>

          <section className='grid gap-3 border-t pt-4'>
            <h3 className='text-sm font-medium'>Scoped CSS</h3>
            <p className='text-xs text-muted-foreground'>
              Declarations for the pages' stable parts. Values follow the token
              rules: no url(), braces or semicolons.
            </p>
            {Object.entries(current.parts).flatMap(([part, style]) =>
              Object.entries(style).map(([property, value]) => (
                <div key={`${part}:${property}`} className='flex gap-2'>
                  <Label
                    htmlFor={`part-${part}-${property}`}
                    className='w-48 shrink-0 font-mono text-xs'
                  >
                    {part} {property}
                  </Label>
                  <Input
                    id={`part-${part}-${property}`}
                    value={value}
                    onChange={(e) =>
                      setDeclaration(part, property, e.currentTarget.value)}
                  />
                  <Button
                    variant='outline'
                    onClick={() =>
                      setDeclaration(part, property, undefined)}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
            <div className='flex gap-2'>
              <select
                aria-label='Part'
                className='rounded-md border bg-background px-2 text-sm'
                value={newPart}
                onChange={(e) => setNewPart(e.currentTarget.value)}
              >
                {PART_NAMES.map((part) => (
                  <option key={part} value={part}>{part}</option>
                ))}
              </select>
              <Input
                aria-label='CSS property'
                placeholder='property, e.g. border-radius'
                value={newProperty}
                onChange={(e) => setNewProperty(e.currentTarget.value.trim())}
              />
              <Button
                variant='outline'
                disabled={!newProperty ||
                  newProperty in (current.parts[newPart] ?? {})}
                onClick={() => {
                  setDeclaration(newPart, newProperty, 'initial')
                  setNewProperty('')
                }}
              >
                Add rule
              </Button>
            </div>
          </section>

          <section className='grid gap-3 border-t pt-4'>
            <h3 className='text-sm font-medium'>Slots ({SLOT_LOCALE})</h3>
            <p className='text-xs text-muted-foreground'>
              Short HTML: p, a (http, mailto or a path), strong, em, lists and
              line breaks. Anything else is refused.
            </p>
            {SLOT_NAMES.map((name) => {
              const html = slots[name] ?? ''
              const problems = sanitizeSlot(html).problems
              return (
                <div key={name} className='grid gap-2'>
                  <Label htmlFor={`slot-${name}`} className='capitalize'>
                    {name}
                  </Label>
                  <Textarea
                    id={`slot-${name}`}
                    rows={2}
                    className='font-mono text-xs'
                    value={html}
                    onChange={(e) => setSlot(name, e.currentTarget.value)}
                  />
                  {problems.length > 0 && (
                    <Alert tone='destructive'>{problems.join('; ')}</Alert>
                  )}
                </div>
              )
            })}
          </section>
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
          {headless
            ? (
              <p className='text-sm text-muted-foreground'>
                Headless: the auth server serves no pages to preview.
              </p>
            )
            : checked.ok
            ? (
              <iframe
                title='Login page preview'
                className='h-[36rem] w-full rounded-md border'
                src={`/preview/${page}?draft=${previewQuery(checked.resolved)}`}
              />
            )
            : (
              <p className='text-sm text-muted-foreground'>
                The preview comes back once the draft is valid.
              </p>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
