import { createRoot } from 'react-dom/client'
import { hasSignInMethod } from '@khatm/pages'
import { PageProvider, readConfig } from './lib/context.tsx'
import { SignIn } from './screens/sign-in.tsx'
import { SignUp } from './screens/sign-up.tsx'
import { Notice } from './screens/notice.tsx'

function Screen({ path, enabled }: { path: string; enabled: boolean }) {
  if (!enabled) {
    return <Notice title='disabled.title' description='disabled.description' />
  }
  if (path === '/signup') return <SignUp />
  if (path === '/error') {
    return <Notice title='error.title' description='error.description' back />
  }
  return <SignIn />
}

const config = readConfig(document)
const root = document.getElementById('root')
if (!root) throw new Error('No #root element')
createRoot(root).render(
  <PageProvider config={config} languages={navigator.languages}>
    <Screen
      path={`/${location.pathname.split('/').pop()}`}
      enabled={hasSignInMethod(config)}
    />
  </PageProvider>,
)
