import { type FormEvent, type ReactNode, useState } from 'react'
import type { UserView } from '@khatm/contract'
import { Calls } from '@khatm/contract/messages'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InputField,
  InputGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useIcon,
} from '@khatm-libs/ui'
import { Describe } from '../control.ts'
import { useControl } from '../control-provider.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'
import { useCall } from '../use-call.ts'

const PAGE = 25

/** The data plane: who uses auth. Every change goes through the control API and lands in the audit log. */
export function Users({ refresh }: { refresh: number }) {
  const control = useControl()
  const PlusIcon = useIcon('plus')
  const SearchIcon = useIcon('search')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)
  const page = useCall(
    () =>
      control.Send(
        new Calls.listUsers({
          search: query || undefined,
          limit: PAGE,
          offset,
        }),
      ),
    [query, offset, refresh, reload],
  )
  const changed = () => setReload((n) => n + 1)

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setOffset(0)
    setQuery(search.trim())
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_24rem]'>
      <Panel
        title='Users'
        description='Search by email, then pick someone to manage them.'
        action={
          <Button
            className='shrink-0'
            variant='secondary'
            size='compact'
            leadingIcon={PlusIcon}
            onClick={() => setCreating(true)}
          >
            New user
          </Button>
        }
      >
        {page.error && <Notice tone='error'>{page.error}</Notice>}
        <form className='flex items-end gap-2' onSubmit={onSearch}>
          <InputGroup className='min-w-0 flex-1'>
            <InputField
              index={0}
              label='Search by email'
              labelHidden
              placeholder='Search by email'
              icon={SearchIcon}
              value={search}
              onChange={setSearch}
            />
          </InputGroup>
          <Button type='submit' className='shrink-0' variant='secondary'>
            Search
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.value?.users.map((user, i) => (
              <TableRow
                key={user.id}
                index={i}
                aria-selected={user.id === selected}
                className='cursor-pointer aria-selected:bg-selected'
                onClick={() => setSelected(user.id)}
              >
                <TableCell>
                  <div className='font-medium text-foreground'>{user.name}</div>
                  <div>{user.email}</div>
                </TableCell>
                <TableCell>{user.role}</TableCell>
                <TableCell>
                  <UserStatus user={user} />
                </TableCell>
                <TableCell>
                  {new Date(user.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {page.value && (
          <div className='flex items-center justify-between text-body text-muted-foreground'>
            <span>
              {page.value.total === 0
                ? 'No users'
                : `${offset + 1}–${
                  offset + page.value.users.length
                } of ${page.value.total}`}
            </span>
            <div className='flex gap-2'>
              <Button
                className='shrink-0'
                variant='ghost'
                size='compact'
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Previous
              </Button>
              <Button
                className='shrink-0'
                variant='ghost'
                size='compact'
                disabled={offset + PAGE >= page.value.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>
      {selected && (
        <UserPanel
          key={selected}
          id={selected}
          onChanged={changed}
          onRemoved={() => {
            setSelected(undefined)
            changed()
          }}
        />
      )}
      <CreateUser
        open={creating}
        onDone={(id) => {
          setCreating(false)
          if (!id) return
          setSelected(id)
          changed()
        }}
      />
    </div>
  )
}

function UserStatus({ user }: { user: UserView }) {
  if (user.banned) return <Badge color='red'>Banned</Badge>
  if (!user.emailVerified) {
    return <Badge variant='dot' color='amber'>Unverified</Badge>
  }
  return <Badge color='green'>Active</Badge>
}

function CreateUser(
  { open, onDone }: { open: boolean; onDone(id?: string): void },
) {
  const control = useControl()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const { user } = await control.Send(
        new Calls.createUser({ email, name, role: role || undefined }),
      )
      setEmail('')
      setName('')
      setRole('')
      onDone(user.id)
    } catch (e) {
      setError(Describe(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDone()}>
      <DialogContent>
        <form className='grid gap-4' onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              The user has no password until you set one or they sign in with a
              provider.
            </DialogDescription>
          </DialogHeader>
          {error && <Notice tone='error'>{error}</Notice>}
          <InputGroup>
            <InputField
              index={0}
              label='Email'
              type='email'
              required
              value={email}
              onChange={setEmail}
            />
            <InputField
              index={1}
              label='Name'
              required
              value={name}
              onChange={setName}
            />
            <InputField
              index={2}
              label='Role'
              placeholder='user'
              value={role}
              onChange={setRole}
            />
          </InputGroup>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => onDone()}>
              Cancel
            </Button>
            <Button type='submit' variant='primary'>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Section(
  { title, action, children }: {
    title: string
    action?: ReactNode
    children: ReactNode
  },
) {
  return (
    <section className='grid grid-cols-1 gap-2'>
      <div className='flex items-center justify-between'>
        <h3 className='text-subtitle font-medium text-foreground'>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function UserPanel(
  { id, onChanged, onRemoved }: {
    id: string
    onChanged(): void
    onRemoved(): void
  },
) {
  const control = useControl()
  const detail = useCall(() => control.Send(new Calls.getUser({ user: id })), [
    id,
  ])
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()
  const [reason, setReason] = useState('')
  const [role, setRole] = useState<string | undefined>()
  const [password, setPassword] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  /** Runs one change, then reloads this user and the list. */
  async function act(done: string, change: () => Promise<unknown>) {
    setError(undefined)
    setMessage(undefined)
    try {
      await change()
      setMessage(done)
      detail.reload()
      onChanged()
    } catch (e) {
      setError(Describe(e))
    }
  }

  if (!detail.value) {
    return detail.error ? <Notice tone='error'>{detail.error}</Notice> : null
  }
  const { user, sessions, accounts } = detail.value
  const typedRole = role ?? user.role ?? ''

  return (
    <Panel
      label={`User ${user.email}`}
      title={user.name}
      description={user.email}
      action={
        <div className='flex gap-2'>
          <UserStatus user={user} />
          {user.username && <Badge variant='dot'>@{user.username}</Badge>}
        </div>
      }
    >
      {error && <Notice tone='error'>{error}</Notice>}
      {message && <Notice tone='success'>{message}</Notice>}

      <Section title='Role'>
        <div className='flex items-end gap-2'>
          <InputGroup className='min-w-0 flex-1'>
            <InputField
              index={0}
              label='Role'
              labelHidden
              value={typedRole}
              onChange={setRole}
            />
          </InputGroup>
          <Button
            className='shrink-0'
            variant='secondary'
            disabled={!typedRole || typedRole === user.role}
            onClick={() =>
              act(`Role set to ${typedRole}`, () =>
                control.Send(new Calls.setRole({ user: id, role: typedRole })))}
          >
            Set role
          </Button>
        </div>
      </Section>

      <Section title='Access'>
        {user.banned
          ? (
            <div className='grid gap-2'>
              <p className='text-body text-muted-foreground'>
                Banned{user.banReason ? `: ${user.banReason}` : ''}
                {user.banExpires &&
                  `, until ${new Date(user.banExpires).toLocaleString()}`}
              </p>
              <Button
                className='shrink-0'
                variant='secondary'
                onClick={() =>
                  act(
                    'Unbanned',
                    () => control.Send(new Calls.unbanUser({ user: id })),
                  )}
              >
                Unban
              </Button>
            </div>
          )
          : (
            <div className='flex items-end gap-2'>
              <InputGroup className='min-w-0 flex-1'>
                <InputField
                  index={0}
                  label='Ban reason'
                  labelHidden
                  placeholder='Reason (optional)'
                  value={reason}
                  onChange={setReason}
                />
              </InputGroup>
              <Button
                className='shrink-0'
                variant='secondary'
                onClick={() =>
                  act(
                    'Banned and signed out',
                    () =>
                      control.Send(
                        new Calls.banUser({
                          user: id,
                          reason: reason || undefined,
                        }),
                      ),
                  )}
              >
                Ban
              </Button>
            </div>
          )}
        {!user.emailVerified && (
          <Button
            className='shrink-0'
            variant='secondary'
            onClick={() =>
              act(
                'Email marked verified',
                () => control.Send(new Calls.verifyEmail({ user: id })),
              )}
          >
            Mark email verified
          </Button>
        )}
        <div className='flex items-end gap-2'>
          <InputGroup className='min-w-0 flex-1'>
            <InputField
              index={0}
              label='New password'
              labelHidden
              type='password'
              autoComplete='new-password'
              placeholder='New password'
              value={password}
              onChange={setPassword}
            />
          </InputGroup>
          <Button
            className='shrink-0'
            variant='secondary'
            disabled={!password}
            onClick={() =>
              act('Password set', async () => {
                await control.Send(
                  new Calls.setPassword({ user: id, password }),
                )
                setPassword('')
              })}
          >
            Set password
          </Button>
        </div>
      </Section>

      <Section title='Sign-in methods'>
        <p className='text-body text-muted-foreground'>
          {accounts.length === 0
            ? 'None yet'
            : accounts.map((a) =>
              a.providerId === 'credential' ? 'password' : a.providerId
            ).join(', ')}
        </p>
      </Section>

      <Section
        title={`Sessions (${sessions.length})`}
        action={sessions.length > 0 && (
          <Button
            className='shrink-0'
            variant='ghost'
            size='compact'
            onClick={() =>
              act(
                'Signed out everywhere',
                () => control.Send(new Calls.revokeSessions({ user: id })),
              )}
          >
            Revoke all
          </Button>
        )}
      >
        <Table size='compact'>
          <TableBody>
            {sessions.map((session, i) => (
              <TableRow key={session.id} index={i}>
                <TableCell>
                  <div className='truncate text-foreground'>
                    {session.userAgent ?? 'Unknown device'}
                  </div>
                  <div className='text-caption'>
                    {session.ipAddress ?? 'no address'} · since{' '}
                    {new Date(session.createdAt).toLocaleString()}
                  </div>
                </TableCell>
                <TableCell className='text-right'>
                  <Button
                    className='shrink-0'
                    variant='ghost'
                    size='compact'
                    onClick={() =>
                      act(
                        'Session revoked',
                        () =>
                          control.Send(
                            new Calls.revokeSessions({
                              user: id,
                              session: session.id,
                            }),
                          ),
                      )}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Button
        variant='tertiary'
        className='w-full text-destructive'
        onClick={() =>
          setConfirmRemove(true)}
      >
        Remove user
      </Button>
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent size='sm'>
          <DialogHeader>
            <DialogTitle>Remove {user.email}?</DialogTitle>
            <DialogDescription>
              Removing {user.email}{' '}
              deletes their sessions and sign-in methods. It can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              className='shrink-0'
              variant='secondary'
              onClick={() =>
                setConfirmRemove(false)}
            >
              Cancel
            </Button>
            <Button
              className='shrink-0'
              variant='primary'
              onClick={async () => {
                try {
                  await control.Send(
                    new Calls.removeUser({ user: id, confirmed: true }),
                  )
                  setConfirmRemove(false)
                  onRemoved()
                } catch (e) {
                  setConfirmRemove(false)
                  setError(Describe(e))
                }
              }}
            >
              Remove for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
