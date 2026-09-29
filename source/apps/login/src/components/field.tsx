import type { InputHTMLAttributes } from 'react'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'

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
