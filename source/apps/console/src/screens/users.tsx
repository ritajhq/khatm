import { type FormEvent, useEffect, useState } from 'react'
import type { UserDetail, UserView } from '@khatm/contract'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@khatm-libs/ui'
import { api, describeError } from '../api.ts'

const PAGE = 25

/** The data plane: who uses auth. Every change goes through the control API and lands in the audit log. */
export function Users({ refresh }: { refresh: number }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<{ users: UserView[]; total: number }>()
  const [selected, setSelected] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api.listUsers({
      search: query || undefined,
      limit: PAGE,
      offset,
    })
      .then(setPage)
      .catch((e) => setError(describeError(e)))
  }, [query, offset, refresh, reload])

  const changed = () => setReload((n) => n + 1)

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setOffset(0)
    setQuery(search.trim())
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_24rem]'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between text-left'>
          <CardTitle className='text-base'>Users</CardTitle>
          <Button size='sm' variant='outline' onClick={() => setCreating(true)}>
            New user
          </Button>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {error && <Alert tone='destructive'>{error}</Alert>}
          {creating && (
            <CreateUser
              onDone={(id) => {
                setCreating(false)
                if (id) {
                  setSelected(id)
                  changed()
                }
              }}
            />
          )}
          <form className='flex gap-2' onSubmit={onSearch}>
            <Input
              aria-label='Search by email'
              placeholder='Search by email'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type='submit' variant='outline'>Search</Button>
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
              {page?.users.map((user) => (
                <TableRow
                  key={user.id}
                  className={cn(
                    'cursor-pointer',
                    user.id === selected && 'bg-muted',
                  )}
                  onClick={() => setSelected(user.id)}
                >
                  <TableCell>
                    <div className='font-medium'>{user.name}</div>
                    <div className='text-muted-foreground'>{user.email}</div>
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
          {page && (
            <div className='flex items-center justify-between text-sm text-muted-foreground'>
              <span>
                {page.total === 0
                  ? 'No users'
                  : `${offset + 1}–${
                    offset + page.users.length
                  } of ${page.total}`}
              </span>
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Previous
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={offset + PAGE >= page.total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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
    </div>
  )
}

function UserStatus({ user }: { user: UserView }) {
  if (user.banned) return <Badge variant='destructive'>Banned</Badge>
  if (!user.emailVerified) return <Badge variant='outline'>Unverified</Badge>
  return <Badge variant='secondary'>Active</Badge>
}

function CreateUser({ onDone }: { onDone(id?: string): void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const { user } = await api.createUser({
        email,
        name,
        role: role || undefined,
      })
      onDone(user.id)
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <form className='grid gap-3 rounded-lg border p-4' onSubmit={submit}>
      {error && <Alert tone='destructive'>{error}</Alert>}
      <div className='grid grid-cols-3 gap-3'>
        <div className='grid gap-1.5'>
          <Label htmlFor='new-email'>Email</Label>
          <Input
            id='new-email'
            type='email'
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor='new-name'>Name</Label>
          <Input
            id='new-name'
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor='new-role'>Role</Label>
          <Input
            id='new-role'
            placeholder='user'
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
      </div>
      <p className='text-xs text-muted-foreground'>
        The user has no password until you set one or they sign in with a
        provider.
      </p>
      <div className='flex gap-2'>
        <Button type='submit' size='sm'>Create</Button>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => onDone()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

function UserPanel(
  { id, onChanged, onRemoved }: {
    id: string
    onChanged(): void
    onRemoved(): void
  },
) {
  const [detail, setDetail] = useState<UserDetail | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()
  const [reason, setReason] = useState('')
  const [role, setRole] = useState('')
  const [password, setPassword] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const load = () =>
    api.getUser({ user: id })
      .then((d) => {
        setDetail(d)
        setRole(d.user.role ?? '')
      })
      .catch((e) => setError(describeError(e)))

  useEffect(() => {
    load()
  }, [id])

  /** Runs one change, then reloads this user and the list. */
  async function act(done: string, change: () => Promise<unknown>) {
    setError(undefined)
    setMessage(undefined)
    try {
      await change()
      setMessage(done)
      await load()
      onChanged()
    } catch (e) {
      setError(describeError(e))
    }
  }

  if (!detail) {
    return error ? <Alert tone='destructive'>{error}</Alert> : null
  }
  const { user, sessions, accounts } = detail

  return (
    <Card aria-label={`User ${user.email}`}>
      <CardHeader className='text-left'>
        <CardTitle className='text-base'>{user.name}</CardTitle>
        <p className='text-sm text-muted-foreground'>{user.email}</p>
        <div className='flex gap-2'>
          <UserStatus user={user} />
          {user.username && <Badge variant='outline'>@{user.username}</Badge>}
        </div>
      </CardHeader>
      <CardContent className='grid gap-5 text-sm'>
        {error && <Alert tone='destructive'>{error}</Alert>}
        {message && <Alert>{message}</Alert>}

        <section className='grid gap-2'>
          <h3 className='font-medium'>Role</h3>
          <div className='flex gap-2'>
            <Input
              aria-label='Role'
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
            <Button
              variant='outline'
              disabled={!role || role === user.role}
              onClick={() =>
                act(
                  `Role set to ${role}`,
                  () => api.setRole({ user: id, role }),
                )}
            >
              Set role
            </Button>
          </div>
        </section>

        <section className='grid gap-2'>
          <h3 className='font-medium'>Access</h3>
          {user.banned
            ? (
              <div className='grid gap-2'>
                <p className='text-muted-foreground'>
                  Banned{user.banReason ? `: ${user.banReason}` : ''}
                  {user.banExpires &&
                    `, until ${new Date(user.banExpires).toLocaleString()}`}
                </p>
                <Button
                  variant='outline'
                  onClick={() =>
                    act('Unbanned', () => api.unbanUser({ user: id }))}
                >
                  Unban
                </Button>
              </div>
            )
            : (
              <div className='flex gap-2'>
                <Input
                  aria-label='Ban reason'
                  placeholder='Reason (optional)'
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  variant='outline'
                  onClick={() =>
                    act('Banned and signed out', () =>
                      api.banUser({
                        user: id,
                        reason: reason || undefined,
                      }))}
                >
                  Ban
                </Button>
              </div>
            )}
          {!user.emailVerified && (
            <Button
              variant='outline'
              onClick={() =>
                act(
                  'Email marked verified',
                  () => api.verifyEmail({ user: id }),
                )}
            >
              Mark email verified
            </Button>
          )}
          <div className='flex gap-2'>
            <Input
              aria-label='New password'
              type='password'
              autoComplete='new-password'
              placeholder='New password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              variant='outline'
              disabled={!password}
              onClick={() =>
                act('Password set', async () => {
                  await api.setPassword({ user: id, password })
                  setPassword('')
                })}
            >
              Set password
            </Button>
          </div>
        </section>

        <section className='grid gap-2'>
          <h3 className='font-medium'>Sign-in methods</h3>
          <p className='text-muted-foreground'>
            {accounts.length === 0
              ? 'None yet'
              : accounts.map((a) =>
                a.providerId === 'credential' ? 'password' : a.providerId
              ).join(', ')}
          </p>
        </section>

        <section className='grid gap-2'>
          <div className='flex items-center justify-between'>
            <h3 className='font-medium'>Sessions ({sessions.length})</h3>
            {sessions.length > 0 && (
              <Button
                size='sm'
                variant='outline'
                onClick={() =>
                  act(
                    'Signed out everywhere',
                    () => api.revokeSessions({ user: id }),
                  )}
              >
                Revoke all
              </Button>
            )}
          </div>
          {sessions.map((session) => (
            <div
              key={session.id}
              className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'
            >
              <div className='min-w-0'>
                <div className='truncate'>
                  {session.userAgent ?? 'Unknown device'}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {session.ipAddress ?? 'no address'} · since{' '}
                  {new Date(session.createdAt).toLocaleString()}
                </div>
              </div>
              <Button
                size='sm'
                variant='outline'
                onClick={() =>
                  act(
                    'Session revoked',
                    () => api.revokeSessions({ user: id, session: session.id }),
                  )}
              >
                Revoke
              </Button>
            </div>
          ))}
        </section>

        <section className='grid gap-2 border-t pt-4'>
          {confirmRemove
            ? (
              <Alert tone='destructive'>
                <p>
                  Removing {user.email}{' '}
                  deletes their sessions and sign-in methods. It can't be
                  undone.
                </p>
                <div className='mt-2 flex gap-2'>
                  <Button
                    size='sm'
                    variant='destructive'
                    onClick={async () => {
                      try {
                        await api.removeUser({ user: id, confirmed: true })
                        onRemoved()
                      } catch (e) {
                        setError(describeError(e))
                      }
                    }}
                  >
                    Remove for good
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setConfirmRemove(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </Alert>
            )
            : (
              <Button
                variant='outline'
                className='text-destructive'
                onClick={() => setConfirmRemove(true)}
              >
                Remove user
              </Button>
            )}
        </section>
      </CardContent>
    </Card>
  )
}
