import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { Control } from './control.ts'
import { ControlProvider } from './control-provider.tsx'

// Wiring only: one connection to the control API, handed to the app. What
// happens after is the app's, in response to the operator.
const control = new Control(location.origin)

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')
createRoot(root).render(
  <StrictMode>
    <ControlProvider control={control}>
      <App />
    </ControlProvider>
  </StrictMode>,
)
