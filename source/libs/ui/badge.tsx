import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils.ts'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-muted text-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge(
  { className, variant, ...props }:
    & HTMLAttributes<HTMLSpanElement>
    & VariantProps<typeof badgeVariants>,
) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
