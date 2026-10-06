import { defaultRegistry } from '@khatm/registry'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
} from '@khatm-libs/ui'
import { type Checked, format, plugins, withPlugin } from '../draft.ts'
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
      <Card>
        <CardHeader className='text-left'>
          <CardTitle className='text-base'>Plugins</CardTitle>
          <CardDescription>
            Forms come from the registry's option schemas. Plugins khatm derives
            itself, like admin, are not listed.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3'>
          {authorable.map((definition) => (
            <PluginForm
              key={definition.kind}
              definition={definition}
              options={checked.ok
                ? current.find((p) => p.kind === definition.kind)?.options ??
                  (current.some((p) => p.kind === definition.kind)
                    ? {}
                    : undefined)
                : undefined}
              onChange={(options) =>
                checked.ok &&
                onChange(
                  format(
                    withPlugin(checked.authored, definition.kind, options),
                  ),
                )}
            />
          ))}
          {!checked.ok && (
            <p className='text-sm text-muted-foreground'>
              Fix the JSON to use the forms.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='text-left'>
          <CardTitle className='text-base'>Manifest</CardTitle>
          <CardDescription>
            Secrets appear as references, never values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label='Manifest JSON'
            spellCheck={false}
            className='min-h-[28rem] font-mono text-xs'
            value={text}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
