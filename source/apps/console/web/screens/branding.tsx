import { useState } from 'react'
import {
  PART_NAMES,
  sanitizeSlot,
  SLOT_NAMES,
  type SlotName,
} from '@khatm/spec'
import {
  Button,
  ColorPickerPopover,
  InputField,
  InputGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch,
  TabsSubtle,
  TabsSubtleItem,
  Tooltip,
  useIcon,
} from '@khatm-libs/ui'
import {
  branding,
  type Checked,
  format,
  previewQuery,
  withBranding,
} from '../draft.ts'
import { CodeField } from '../components/code-field.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'

const PAGES = ['login', 'signup', 'error'] as const

/** Slots are edited in English; other locales go in the manifest JSON. */
const SLOT_LOCALE = 'en'

/** Branding edits with a live preview of the real login pages, rendered by this console, not the auth server. */
export function Branding(
  { checked, onChange }: { checked: Checked; onChange(text: string): void },
) {
  const PlusIcon = useIcon('plus')
  const RemoveIcon = useIcon('x')
  const [page, setPage] = useState(0)
  const [newToken, setNewToken] = useState('')
  const [newPart, setNewPart] = useState<string>(PART_NAMES[0])
  const [newProperty, setNewProperty] = useState('')
  // A draft that doesn't resolve stays editable here, so a half-typed slot
  // doesn't take the editor away; the plan bar lists what is wrong.
  const authored = checked.authored
  if (!authored) {
    return <Notice tone='warning'>Fix the manifest to edit branding.</Notice>
  }
  const current = branding(authored)
  const update = (next: typeof current) =>
    onChange(format(withBranding(authored, next)))
  const slots = current.slots[SLOT_LOCALE] ?? {}
  const setToken = (name: string, value: string) =>
    update({ ...current, tokens: { ...current.tokens, [name]: value } })
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
  const remove = (label: string, onRemove: () => void) => (
    <Tooltip content={label}>
      <Button
        className='shrink-0'
        variant='ghost'
        size='icon'
        aria-label={label}
        leadingIcon={RemoveIcon}
        onClick={onRemove}
      />
    </Tooltip>
  )

  return (
    <div className='grid gap-6 lg:grid-cols-2'>
      <div className='grid min-w-0 content-start gap-6'>
        <Panel
          title='Identity'
          description='The name the pages show, and the design tokens they use.'
        >
          <InputGroup>
            <InputField
              index={0}
              label='Name'
              value={current.name ?? ''}
              onChange={(name) =>
                update({ ...current, name: name || undefined })}
            />
          </InputGroup>
          {Object.entries(current.tokens).map(([name, value]) => (
            <div key={name} className='flex items-end gap-2'>
              <InputGroup className='min-w-0 flex-1'>
                <InputField
                  index={0}
                  label={`--${name}`}
                  value={value}
                  onChange={(next) =>
                    setToken(name, next)}
                />
              </InputGroup>
              <ColorPickerPopover
                value={value}
                onValueChange={(next) =>
                  setToken(name, next)}
                triggerLabel={`Pick --${name}`}
              />
              {remove(`Remove --${name}`, () => {
                const { [name]: _, ...rest } = current.tokens
                update({ ...current, tokens: rest })
              })}
            </div>
          ))}
          <div className='flex items-end gap-2'>
            <InputGroup className='min-w-0 flex-1'>
              <InputField
                index={0}
                label='New token name'
                placeholder='primary, background, radius…'
                value={newToken}
                onChange={(name) => setNewToken(name.trim())}
              />
            </InputGroup>
            <Button
              className='shrink-0'
              variant='secondary'
              leadingIcon={PlusIcon}
              disabled={!newToken || newToken in current.tokens}
              onClick={() => {
                setToken(newToken, 'black')
                setNewToken('')
              }}
            >
              Add token
            </Button>
          </div>
          <Switch
            label='Headless: serve no pages, our apps build their own'
            checked={headless}
            onToggle={() =>
              update({ ...current, pages: headless ? 'hosted' : 'headless' })}
          />
        </Panel>

        <Panel
          title='Scoped CSS'
          description="Declarations for the pages' stable parts. Values follow the token rules: no url(), braces or semicolons."
        >
          {Object.entries(current.parts).flatMap(([part, style]) =>
            Object.entries(style).map(([property, value]) => (
              <div key={`${part}:${property}`} className='flex items-end gap-2'>
                <InputGroup className='min-w-0 flex-1'>
                  <InputField
                    index={0}
                    label={`${part} ${property}`}
                    value={value}
                    onChange={(next) =>
                      setDeclaration(part, property, next)}
                  />
                </InputGroup>
                {remove(`Remove ${part} ${property}`, () =>
                  setDeclaration(part, property, undefined))}
              </div>
            ))
          )}
          <div className='flex items-end gap-2'>
            <Select value={newPart} onValueChange={setNewPart}>
              <SelectTrigger aria-label='Part' className='w-40' />
              <SelectContent>
                {PART_NAMES.map((part, i) => (
                  <SelectItem key={part} index={i} value={part}>
                    {part}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InputGroup className='min-w-0 flex-1'>
              <InputField
                index={0}
                label='CSS property'
                placeholder='border-radius'
                value={newProperty}
                onChange={(property) => setNewProperty(property.trim())}
              />
            </InputGroup>
            <Button
              className='shrink-0'
              variant='secondary'
              leadingIcon={PlusIcon}
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
        </Panel>

        <Panel
          title={`Slots (${SLOT_LOCALE})`}
          description='Short HTML: p, a (http, mailto or a path), strong, em, lists and line breaks. Anything else is refused.'
        >
          {SLOT_NAMES.map((name) => {
            const html = slots[name] ?? ''
            const problems = sanitizeSlot(html).problems
            return (
              <label key={name} className='grid gap-1'>
                <span className='text-caption capitalize text-muted-foreground'>
                  {name}
                </span>
                <CodeField
                  id={`slot-${name}`}
                  aria-label={name.charAt(0).toUpperCase() + name.slice(1)}
                  rows={2}
                  value={html}
                  onChange={(e) => setSlot(name, e.currentTarget.value)}
                />
                {problems.length > 0 && (
                  <Notice tone='error'>{problems.join('; ')}</Notice>
                )}
              </label>
            )
          })}
        </Panel>
      </div>

      <Panel
        title='Preview'
        className='self-start lg:sticky lg:top-4'
        action={
          <TabsSubtle
            selectedIndex={page}
            onSelect={setPage}
            idPrefix='preview'
          >
            {PAGES.map((p, i) => (
              <TabsSubtleItem
                key={p}
                index={i}
                label={p}
              />
            ))}
          </TabsSubtle>
        }
      >
        {headless
          ? (
            <Notice>
              Headless: the auth server serves no pages to preview.
            </Notice>
          )
          : checked.ok
          ? (
            <iframe
              title='Login page preview'
              className='h-[36rem] w-full rounded-lg bg-background shadow-surface-1'
              src={`/preview/${PAGES[page]}?draft=${
                previewQuery(checked.resolved)
              }`}
            />
          )
          : (
            <Notice tone='warning'>
              The preview comes back once the draft is valid.
            </Notice>
          )}
      </Panel>
    </div>
  )
}
