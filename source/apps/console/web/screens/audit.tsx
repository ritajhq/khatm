import { useEffect, useState } from 'react'
import type { AuditEntryView } from '@khatm/contract'
import { Calls } from '@khatm/contract/messages'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@khatm-libs/ui'
import { Describe } from '../control.ts'
import { useControl } from '../control-provider.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'

const PAGE = 50

/** Who did what to whom, across both planes, newest first. */
export function Audit({ refresh }: { refresh: number }) {
  const control = useControl()
  const [entries, setEntries] = useState<AuditEntryView[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    control.Send(new Calls.audit({ limit: PAGE }))
      .then(({ entries }) => {
        setEntries(entries)
        setMore(entries.length === PAGE)
      })
      .catch((e) => setError(Describe(e)))
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
    control.Send(new Calls.lookupUsers({ ids }))
      .then(({ users }) =>
        setEmails((known) => ({
          ...known,
          ...Object.fromEntries(users.map((u) => [u.id, u.email])),
        }))
      )
      .catch(() => {})
  }, [entries])

  const who = (id: string) => (
    <Tooltip content={id}>
      <span>{emails[id] ?? short(id)}</span>
    </Tooltip>
  )

  async function older() {
    try {
      const { entries: next } = await control.Send(
        new Calls.audit({
          limit: PAGE,
          before: entries[entries.length - 1].id,
        }),
      )
      setEntries([...entries, ...next])
      setMore(next.length === PAGE)
    } catch (e) {
      setError(Describe(e))
    }
  }

  return (
    <Panel
      title='Audit log'
      description='Every change, by whom and how it ended'
    >
      {error && <Notice tone='error'>{error}</Notice>}
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
          {entries.map((entry, i) => (
            <TableRow key={entry.id} index={i}>
              <TableCell className='whitespace-nowrap'>
                {new Date(entry.at).toLocaleString()}
              </TableCell>
              <TableCell>{who(entry.actor)}</TableCell>
              <TableCell>
                <div className='flex items-center gap-2'>
                  {entry.action}
                  {entry.outcome !== 'ok' && (
                    <Badge color='red'>{entry.outcome}</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {entry.target
                  ? who(entry.target)
                  : entry.revision && who(entry.revision)}
              </TableCell>
              <TableCell className='max-w-xs break-words whitespace-normal text-caption'>
                {Object.entries(entry.details)
                  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                  .join(', ')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {entries.length === 0 && !error && (
        <p className='text-body text-muted-foreground'>Nothing audited yet</p>
      )}
      {more && (
        <Button variant='secondary' onClick={older}>Older entries</Button>
      )}
    </Panel>
  )
}

/** Long ids, cut to what tells them apart at a glance. */
function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
