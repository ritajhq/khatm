import { useEffect, useMemo, useState } from 'react'
import { Calls } from '@khatm/contract/messages'
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuInput,
  CommandMenuList,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarInsetTopbar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarWorkspaceHeader,
  TooltipProvider,
  useIcon,
  useIcons,
  WorkspaceTile,
} from '@khatm-libs/ui'
import { Describe, Rejected } from './control.ts'
import { useControl } from './control-provider.tsx'
import { check, format } from './draft.ts'
import { Notice } from './components/notice.tsx'
import { PlanBar } from './components/plan-bar.tsx'
import { PLANES, type Screen, ScreenOf, SCREENS } from './screens.ts'
import { Audit } from './screens/audit.tsx'
import { Branding } from './screens/branding.tsx'
import { Configuration } from './screens/configuration.tsx'
import { Overview } from './screens/overview.tsx'
import { Revisions } from './screens/revisions.tsx'
import { Users } from './screens/users.tsx'

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

/** The screen the URL's hash names, following it as it changes. */
function useScreen(): Screen {
  const [screen, setScreen] = useState(() => ScreenOf(location.hash))
  useEffect(() => {
    const onHash = () => setScreen(ScreenOf(location.hash))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  return screen
}

/** The console: a sidebar of screens over the two planes, and the screen it shows. */
export function App() {
  const control = useControl()
  const screen = useScreen()
  const [text, setText] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const [signedOut, setSignedOut] = useState(false)
  const [palette, setPalette] = useState(false)
  const checked = useMemo(() => text === undefined ? undefined : check(text), [
    text,
  ])

  useEffect(() => {
    const subscription = control.OnSessionRefused.Do(() => setSignedOut(true))
    return () => subscription.Dispose()
  }, [control])

  // The draft starts from what is serving, reloaded after every apply.
  useEffect(() => {
    control.Send(new Calls.manifest({}))
      .then((m) => setText(format(m.authored ?? m.resolved)))
      .catch((e) => {
        if (e instanceof Rejected && e.Code === 'no_active_revision') {
          setText(format(STARTER))
        } else setError(Describe(e))
      })
  }, [refresh])

  const changed = () => setRefresh((n) => n + 1)
  const go = (next: Screen) => {
    location.hash = `#/${next.id}`
  }

  return (
    <TooltipProvider>
      <SidebarProvider peek='hover'>
        <ConsoleSidebar
          active={screen}
          onRefresh={changed}
          onSearch={() => setPalette(true)}
        />
        <SidebarInset>
          <SidebarInsetTopbar>
            <h1 className='text-title font-medium text-foreground'>
              {screen.label}
            </h1>
            <p className='ml-2 hidden text-body text-muted-foreground md:block'>
              {screen.description}
            </p>
          </SidebarInsetTopbar>
          <main className='mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-6'>
            {signedOut && (
              <Notice tone='warning'>
                Your session ended: sign in again, then refresh.
              </Notice>
            )}
            {error && <Notice tone='error'>{error}</Notice>}
            {screen.id === 'overview' && <Overview refresh={refresh} />}
            {screen.id === 'revisions' && (
              <Revisions refresh={refresh} onChanged={changed} />
            )}
            {screen.id === 'users' && <Users refresh={refresh} />}
            {screen.id === 'audit' && <Audit refresh={refresh} />}
            {screen.edits && text !== undefined && checked && (
              <>
                {screen.id === 'configuration'
                  ? (
                    <Configuration
                      text={text}
                      checked={checked}
                      onChange={setText}
                    />
                  )
                  : <Branding checked={checked} onChange={setText} />}
                <PlanBar
                  key={screen.id}
                  checked={checked}
                  onApplied={changed}
                />
              </>
            )}
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Palette open={palette} onOpenChange={setPalette} onGo={go} />
    </TooltipProvider>
  )
}

function ConsoleSidebar(
  { active, onRefresh, onSearch }: {
    active: Screen
    onRefresh(): void
    onSearch(): void
  },
) {
  const icons = useIcons()
  const SearchIcon = useIcon('search')
  const RefreshIcon = useIcon('rotate-ccw')
  return (
    <Sidebar variant='inset'>
      <SidebarHeader>
        <SidebarWorkspaceHeader
          name='khatm'
          tile={<WorkspaceTile>K</WorkspaceTile>}
        />
      </SidebarHeader>
      <SidebarContent>
        {PLANES.map(({ plane, label }) => (
          <SidebarGroup key={plane}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            <SidebarMenu>
              {SCREENS.filter((screen) => screen.plane === plane).map((
                screen,
              ) => (
                <SidebarMenuItem key={screen.id}>
                  <SidebarMenuButton
                    icon={icons[screen.icon]}
                    isActive={screen.id === active.id}
                    onClick={() => (location.hash = `#/${screen.id}`)}
                  >
                    {screen.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton icon={SearchIcon} onClick={onSearch}>
              Go to…
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton icon={RefreshIcon} onClick={onRefresh}>
              Refresh
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

/** ⌘K: jump to any screen by name. */
function Palette(
  { open, onOpenChange, onGo }: {
    open: boolean
    onOpenChange(open: boolean): void
    onGo(screen: Screen): void
  },
) {
  const icons = useIcons()
  const items = SCREENS.map((screen) => ({
    value: screen.id,
    label: screen.label,
    description: screen.description,
    icon: icons[screen.icon],
    group: PLANES.find(({ plane }) => plane === screen.plane)?.label,
    onSelect: () => onGo(screen),
  }))
  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Go to a screen'
    >
      <CommandMenu items={items}>
        <CommandMenuInput placeholder='Go to…' />
        <CommandMenuList />
        <CommandMenuEmpty>No screen by that name</CommandMenuEmpty>
      </CommandMenu>
    </CommandMenuDialog>
  )
}
