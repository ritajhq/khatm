import type { InputHTMLAttributes } from 'react'
import { Input, Label } from '@khatm-libs/ui'

export function Field(
  { label, id, ...props }:
    & { label: string; id: string }
    & InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <div className='grid gap-2'>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  )
}
