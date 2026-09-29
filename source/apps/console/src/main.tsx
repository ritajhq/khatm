import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Button, cn } from '@khatm-libs/ui'
import { api, ControlError, describeError } from './api.ts'
import { check, format } from './draft.ts'
import { PlanBar } from './components/plan-bar.tsx'
import { Overview } from './screens/overview.tsx'
import { Revisions } from './screens/revisions.tsx'
import { Configuration } from './screens/configuration.tsx'
import { Branding } from './screens/branding.tsx'

const TABS = ['overview', 'revisions', 'configuration', 'branding'] as const
type Tab = typeof TABS[number]

/** Where a fresh install's draft starts: the smallest manifest that resolves. */
const STARTER = {
  auth: {
    baseURL: 'https://auth.example.com',
    secrets: [{ version: 1, value: { env: 'AUTH_SECRET' } }],
    database: { dialect: 'postgres', url: { env: 'DATABASE_URL' } },
    emailAndPassword: { enabled: true },
    applications: [],
    session: {
      introspectionURL: 'http://auth:4100/api/auth/get-session',
      issuer: 'khatm',
      claims: ['email', 'name'],
    },
  },
}

function tabFromHash(): Tab {
  const hash = location.hash.replace('#/', '') as Tab
  return TABS.includes(hash) ? hash : 'overview'
}

function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [text, setText] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const checked = useMemo(() => text === undefined ? undefined : check(text), [
    text,
  ])

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  // The draft starts from what is serving, reloaded after every apply.
  useEffect(() => {
    api.manifest({})
      .then((m) => setText(format(m.authored ?? m.resolved)))
      .catch((e) => {
        if (e instanceof ControlError && e.code === 'no_active_revision') {
          setText(format(STARTER))
        } else setError(describeError(e))
      })
  }, [refresh])

  const changed = () => setRefresh((n) => n + 1)
  const editing = tab === 'configuration' || tab === 'branding'

  return (
    <div className='min-h-svh bg-muted'>
      <header className='border-b bg-background'>
        <nav className='mx-auto flex max-w-6xl items-center gap-2 px-6 py-3'>
          <span className='mr-4 font-semibold'>khatm</span>
          {TABS.map((t) => (
            <a
              key={t}
              href={`#/${t}`}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm capitalize',
                t === tab ? 'bg-muted font-medium' : 'text-muted-foreground',
              )}
            >
              {t}
            </a>
          ))}
          <Button
            size='sm'
            variant='outline'
            className='ml-auto'
            onClick={changed}
          >
            Refresh
          </Button>
        </nav>
      </header>
      <main className='mx-auto grid max-w-6xl gap-6 p-6'>
        {error && <Alert tone='destructive'>{error}</Alert>}
        {tab === 'overview' && <Overview refresh={refresh} />}
        {tab === 'revisions' && (
          <Revisions refresh={refresh} onChanged={changed} />
        )}
        {editing && text !== undefined && checked && (
          <>
            {tab === 'configuration'
              ? (
                <Configuration
                  text={text}
                  checked={checked}
                  onChange={setText}
                />
              )
              : <Branding checked={checked} onChange={setText} />}
            <PlanBar key={tab} checked={checked} onApplied={changed} />
          </>
        )}
      </main>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')
createRoot(root).render(<App />)
