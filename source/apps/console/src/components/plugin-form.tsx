import {
  type FormField,
  formFields,
  type PluginDefinition,
} from '@khatm/registry'
import { Input, Label } from '@khatm-libs/ui'

/** A plugin's switch and its options, generated from the registry's schema. */
export function PluginForm(
  { definition, options, onChange }: {
    definition: PluginDefinition
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
  return (
    <fieldset className='grid gap-3 rounded-lg border p-4'>
      <label className='flex items-center gap-2 font-medium'>
        <input
          type='checkbox'
          checked={on}
          onChange={(e) => onChange(e.currentTarget.checked ? {} : undefined)}
        />
        {definition.kind}
      </label>
      {on && fields.map((field) => (
        <FieldInput
          key={field.name}
          id={`${definition.kind}-${field.name}`}
          field={field}
          value={options[field.name]}
          onChange={(v) => set(field.name, v)}
        />
      ))}
      {on && unsupported.length > 0 && (
        <p className='text-xs text-muted-foreground'>
          Edit {unsupported.join(', ')} in the JSON.
        </p>
      )}
    </fieldset>
  )
}

function FieldInput(
  { id, field, value, onChange }: {
    id: string
    field: FormField
    value: unknown
    onChange(value: unknown): void
  },
) {
  const label = `${field.name}${field.required ? '' : ' (optional)'}`
  switch (field.type) {
    case 'boolean':
      return (
        <label className='flex items-center gap-2 text-sm'>
          <input
            id={id}
            type='checkbox'
            checked={value === true}
            onChange={(e) => onChange(e.currentTarget.checked || undefined)}
          />
          {label}
        </label>
      )
    case 'enum':
      return (
        <div className='grid gap-2'>
          <Label htmlFor={id}>{label}</Label>
          <select
            id={id}
            className='h-9 rounded-md border bg-transparent px-2 text-sm'
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.currentTarget.value || undefined)}
          >
            <option value=''>—</option>
            {field.values.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )
    case 'integer':
    case 'number':
      return (
        <div className='grid gap-2'>
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            type='number'
            step={field.type === 'integer' ? 1 : 'any'}
            min={field.minimum}
            max={field.maximum}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) =>
              onChange(
                e.currentTarget.value === ''
                  ? undefined
                  : Number(e.currentTarget.value),
              )}
          />
        </div>
      )
    default:
      return (
        <div className='grid gap-2'>
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.currentTarget.value || undefined)}
          />
        </div>
      )
  }
}
