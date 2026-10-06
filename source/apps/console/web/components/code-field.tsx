import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@khatm-libs/ui'

/**
 * Multi-line monospace text — the manifest, slot markup. Fluid has no
 * multi-line field, so this one takes its look from Fluid's tokens: the
 * input radius, the hover and focus ring.
 */
export function CodeField(
  { className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      spellCheck={false}
      className={cn(
        'w-full rounded-[var(--shape-input-radius,8px)] bg-surface-1 px-3 py-2 font-mono text-caption text-foreground',
        'shadow-surface-1 outline-none transition-shadow hover:bg-hover focus-visible:shadow-surface-3',
        className,
      )}
      {...props}
    />
  )
}
