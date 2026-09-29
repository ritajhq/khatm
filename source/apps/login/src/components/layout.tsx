import type { ReactNode } from 'react'
import { usePage } from '../lib/context.tsx'

export function Layout({ children }: { children: ReactNode }) {
  const { config } = usePage()
  return (
    <main className='flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10'>
      <div className='flex w-full max-w-sm flex-col gap-6'>
        {config.name && (
          <div className='self-center text-lg font-medium'>{config.name}</div>
        )}
        {children}
      </div>
    </main>
  )
}
