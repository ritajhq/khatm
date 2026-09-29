import type { LabelHTMLAttributes } from 'react'
import { cn } from './utils.ts'

export function Label(
  { className, ...props }: LabelHTMLAttributes<HTMLLabelElement>,
) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none',
        className,
      )}
      {...props}
    />
  )
}
