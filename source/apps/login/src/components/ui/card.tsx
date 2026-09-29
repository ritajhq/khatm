import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

type Props = HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: Props) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 px-6 text-center', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: Props) {
  return (
    <h1
      className={cn('text-xl leading-none font-semibold', className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: Props) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)} {...props} />
  )
}

export function CardContent({ className, ...props }: Props) {
  return <div className={cn('px-6', className)} {...props} />
}
