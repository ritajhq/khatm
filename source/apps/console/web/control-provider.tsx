import { createContext, type ReactNode, useContext } from 'react'
import type { Control } from './control.ts'

const ControlContext = createContext<Control | null>(null)

/** Hands the console's one `Control` to every screen below it. */
export function ControlProvider(
  { control, children }: { control: Control; children: ReactNode },
) {
  return (
    <ControlContext.Provider value={control}>
      {children}
    </ControlContext.Provider>
  )
}

export function useControl(): Control {
  const control = useContext(ControlContext)
  if (!control) {
    throw new Error('useControl must be used within a ControlProvider')
  }
  return control
}
