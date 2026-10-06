import {
  type FormField,
  formFields,
  type PluginDefinition,
} from '@khatm/registry'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  InputField,
  InputGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch,
} from '@khatm-libs/ui'

/** A plugin's switch and its options, generated from the registry's schema. */
export function PluginForm(
  { definition, index, options, onChange }: {
    definition: PluginDefinition
    index: number
    /** Undefined when the plugin is off. */
    options: Record<string, unknown> | undefined
    onChange(options: Record<string, unknown> | undefined): void
  },
) {
  const { fields, unsupported } = formFields(definition.options)
  const on = options !== undefined
  const set = (name: string, value: unknown) => {
    const next = { ...options }
    if (value === undefined || value === '') delete next[name]
    else next[name] = value
    onChange(next)
  }
  const choices = fields.filter((field) =>
    field.type === 'boolean' || field.type === 'enum'
  )
  const inputs = fields.filter((field) =>
    field.type !== 'boolean' && field.type !== 'enum'
  )

  return (
    <AccordionItem value={definition.kind} index={index}>
      <AccordionTrigger>
        <span className='flex items-center gap-2'>
          {definition.kind}
          {on && <Badge color='green' size='compact'>on</Badge>}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className='grid gap-3 pb-2'>
          <Switch
            label={definition.kind}
            checked={on}
            onToggle={() => onChange(on ? undefined : {})}
          />
          {on && choices.map((field) => (
            <Choice
              key={field.name}
              id={`${definition.kind}-${field.name}`}
              field={field}
              value={options[field.name]}
              onChange={(v) => set(field.name, v)}
            />
          ))}
          {on && inputs.length > 0 && (
            <InputGroup>
              {inputs.map((field, i) => (
                <InputField
                  key={field.name}
                  index={i}
                  label={labelOf(field)}
                  type={field.type === 'integer' || field.type === 'number'
                    ? 'number'
                    : 'text'}
                  value={valueOf(options[field.name])}
                  onChange={(text) => set(field.name, parse(field, text))}
                />
              ))}
            </InputGroup>
          )}
          {on && unsupported.length > 0 && (
            <p className='text-caption text-muted-foreground'>
              Edit {unsupported.join(', ')} in the JSON.
            </p>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

/** A field with a fixed set of answers: a switch for yes or no, a select for an enum. */
function Choice(
  { id, field, value, onChange }: {
    id: string
    field: FormField
    value: unknown
    onChange(value: unknown): void
  },
) {
  if (field.type === 'boolean') {
    return (
      <Switch
        id={id}
        label={labelOf(field)}
        checked={value === true}
        onToggle={() => onChange(value === true ? undefined : true)}
      />
    )
  }
  const values = field.type === 'enum' ? field.values : []
  return (
    <div className='grid gap-1'>
      <span className='text-caption text-muted-foreground'>
        {labelOf(field)}
      </span>
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v || undefined)}
      >
        <SelectTrigger
          id={id}
          aria-label={labelOf(field)}
          placeholder='Default'
        />
        <SelectContent>
          {values.map((v, i) => (
            <SelectItem key={v} index={i} value={v}>{v}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function labelOf(field: FormField): string {
  return `${field.name}${field.required ? '' : ' (optional)'}`
}

function valueOf(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string'
    ? String(value)
    : ''
}

function parse(field: FormField, text: string): unknown {
  if (text === '') return undefined
  return field.type === 'integer' || field.type === 'number'
    ? Number(text)
    : text
}
