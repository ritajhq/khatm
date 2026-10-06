import { useEffect, useState } from 'react'
import type { RevisionView } from '@khatm/contract'
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
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
import { Doctor } from '../components/doctor.tsx'

type Event = { at: string; type: string; data: Record<string, unknown> }

export function Overview({ refresh }: { refresh: number }) {
  const [active, setActive] = useState<RevisionView | undefined | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    Promise.all([api.status({}), api.events({ limit: 20 })])
      .then(([status, recent]) => {
        setActive(status.active)
        setEvents([...recent.events].reverse())
      })
      .catch((e) => setError(describeError(e)))
  }, [refresh])

  return (
    <div className='grid gap-6'>
      {error && <Alert tone='destructive'>{error}</Alert>}
      <Card>
        <CardHeader className='text-left'>
          <CardTitle className='text-base'>Serving</CardTitle>
          <CardDescription>
            {active === null
              ? 'Loading…'
              : active
              ? `Revision ${active.id}`
              : 'Nothing has been applied yet'}
          </CardDescription>
        </CardHeader>
        {active && (
          <CardContent className='grid gap-1 text-sm'>
            <span>
              Applied by {active.author} on{' '}
              {new Date(active.createdAt).toLocaleString()}
            </span>
            {active.reason && (
              <span className='text-muted-foreground'>{active.reason}</span>
            )}
            <span className='font-mono text-xs text-muted-foreground'>
              {active.manifest}
            </span>
          </CardContent>
        )}
      </Card>
      {active && <Doctor />}
      <Card>
        <CardHeader className='text-left'>
          <CardTitle className='text-base'>Recent events</CardTitle>
          <CardDescription>
            What this orchestrator did since it started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {new Date(event.at).toLocaleTimeString()}
                  </TableCell>
                  <TableCell>{event.type}</TableCell>
                  <TableCell className='max-w-md truncate font-mono text-xs'>
                    {JSON.stringify(event.data)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
