import { useEffect, useState } from 'react'
import type { AuditEntryView } from '@khatm/contract'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@khatm-libs/ui'
import { api, describeError } from '../api.ts'

const PAGE = 50

/** Who did what to whom, across both planes, newest first. */
export function Audit({ refresh }: { refresh: number }) {
  const [entries, setEntries] = useState<AuditEntryView[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    api.audit({ limit: PAGE })
      .then(({ entries }) => {
        setEntries(entries)
        setMore(entries.length === PAGE)
      })
      .catch((e) => setError(describeError(e)))
  }, [refresh])

  // Actors and targets are user ids; show who they are where the user still exists.
  useEffect(() => {
    const ids = [
      ...new Set(entries.flatMap((e) => [
        e.actor,
        ...(e.target && /^(users|sessions)\./.test(e.action) ? [e.target] : []),
      ])),
    ].filter((id) => !(id in emails)).slice(0, 100)
    if (ids.length === 0) return
    api.lookupUsers({ ids })
      .then(({ users }) =>
        setEmails((known) => ({
          ...known,
          ...Object.fromEntries(users.map((u) => [u.id, u.email])),
        }))
      )
      .catch(() => {})
  }, [entries])

  const who = (id: string) => <span title={id}>{emails[id] ?? short(id)}</span>

  async function older() {
    try {
      const { entries: next } = await api.audit({
        limit: PAGE,
        before: entries[entries.length - 1].id,
      })
      setEntries([...entries, ...next])
      setMore(next.length === PAGE)
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <Card>
      <CardHeader className='text-left'>
        <CardTitle className='text-base'>Audit log</CardTitle>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {error && <Alert tone='destructive'>{error}</Alert>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className='whitespace-nowrap'>
                  {new Date(entry.at).toLocaleString()}
                </TableCell>
                <TableCell>{who(entry.actor)}</TableCell>
                <TableCell>
                  <div className='flex items-center gap-2'>
                    {entry.action}
                    {entry.outcome !== 'ok' && (
                      <Badge variant='destructive'>{entry.outcome}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {entry.target
                    ? who(entry.target)
                    : entry.revision && who(entry.revision)}
                </TableCell>
                <TableCell className='max-w-xs text-xs break-words whitespace-normal text-muted-foreground'>
                  {Object.entries(entry.details)
                    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                    .join(', ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {entries.length === 0 && !error && (
          <p className='text-sm text-muted-foreground'>Nothing audited yet</p>
        )}
        {more && (
          <Button variant='outline' onClick={older}>Older entries</Button>
        )}
      </CardContent>
    </Card>
  )
}

/** Long ids, cut to what tells them apart at a glance. */
function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
