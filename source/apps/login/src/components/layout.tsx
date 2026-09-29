import type { ReactNode } from 'react'
import type { SlotName } from '@khatm/spec'
import { usePage } from '../lib/context.tsx'

/** Operator markup, sanitized by khatm before it reached the page and again here. */
function Slot({ name, className }: { name: SlotName; className?: string }) {
  const { slot } = usePage()
  const html = slot(name)
  if (!html) return null
  return (
    <div
      data-khatm-part={`slot-${name}`}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { config } = usePage()
  return (
    <main
      data-khatm-part='page'
      className='flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10'
    >
      <div className='flex w-full max-w-sm flex-col gap-6'>
        <Slot name='header' className='text-center text-sm' />
        {config.name && (
          <div
            data-khatm-part='brand'
            className='self-center text-lg font-medium'
          >
            {config.name}
          </div>
        )}
        {children}
        <Slot
          name='legal'
          className='text-center text-xs text-muted-foreground [&_a]:underline'
        />
      </div>
      <Slot
        name='footer'
        className='text-center text-xs text-muted-foreground [&_a]:underline'
      />
    </main>
  )
}
