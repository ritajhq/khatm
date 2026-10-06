import type { InputHTMLAttributes } from 'react'
import { Input, Label } from './ui/index.ts'

export function Field(
  { label, id, ...props }:
    & { label: string; id: string }
    & InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <div data-khatm-part='field' className='grid gap-2'>
      <Label data-khatm-part='label' htmlFor={id}>{label}</Label>
      <Input data-khatm-part='input' id={id} name={id} {...props} />
    </div>
  )
}
