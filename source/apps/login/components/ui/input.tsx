import type { InputHTMLAttributes } from 'react'
import { cn } from './utils.ts'

export function Input(
  { className, ...props }: InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}
