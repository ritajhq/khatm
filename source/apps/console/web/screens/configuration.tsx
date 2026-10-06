import { defaultRegistry } from '@khatm/registry'
import { Accordion } from '@khatm-libs/ui'
import { type Checked, format, plugins, withPlugin } from '../draft.ts'
import { CodeField } from '../components/code-field.tsx'
import { Panel } from '../components/panel.tsx'
import { PluginForm } from '../components/plugin-form.tsx'

/** The draft as JSON, plus a form for each plugin the registry lets an operator write. */
export function Configuration(
  { text, checked, onChange }: {
    text: string
    checked: Checked
    onChange(text: string): void
  },
) {
  const authorable = defaultRegistry().list().filter((d) => d.authorable)
  const current = checked.ok ? plugins(checked.authored) : []
  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_2fr]'>
      <Panel
        title='Plugins'
        description="Forms come from the registry's option schemas. Plugins khatm derives itself, like admin, are not listed."
      >
        {checked.ok
          ? (
            <Accordion type='multiple'>
              {authorable.map((definition, index) => (
                <PluginForm
                  key={definition.kind}
                  index={index}
                  definition={definition}
                  options={current.find((p) => p.kind === definition.kind)
                    ?.options ??
                    (current.some((p) => p.kind === definition.kind)
                      ? {}
                      : undefined)}
                  onChange={(options) =>
                    onChange(
                      format(
                        withPlugin(checked.authored, definition.kind, options),
                      ),
                    )}
                />
              ))}
            </Accordion>
          )
          : (
            <p className='text-body text-muted-foreground'>
              Fix the JSON to use the forms.
            </p>
          )}
      </Panel>
      <Panel
        title='Manifest'
        description='Secrets appear as references, never values.'
      >
        <CodeField
          aria-label='Manifest JSON'
          className='min-h-[28rem]'
          value={text}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      </Panel>
    </div>
  )
}
