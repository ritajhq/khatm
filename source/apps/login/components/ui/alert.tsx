import type { HTMLAttributes } from 'react'
import { cn } from './utils.ts'

export function Alert(
  { className, tone = 'default', ...props }:
    & HTMLAttributes<HTMLDivElement>
    & { tone?: 'default' | 'destructive' },
) {
  return (
    <div
      role={tone === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'destructive'
          ? 'border-destructive/50 text-destructive'
          : 'bg-muted text-foreground',
        className,
      )}
      {...props}
    />
  )
}
