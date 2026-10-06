import { Calls } from '@khatm/contract/messages'
import {
  InputCopy,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@khatm-libs/ui'
import { useControl } from '../control-provider.tsx'
import { Doctor } from '../components/doctor.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'
import { useCall } from '../use-call.ts'

/** What is serving, whether it is healthy, and what the orchestrator did lately. */
export function Overview({ refresh }: { refresh: number }) {
  const control = useControl()
  const status = useCall(() => control.Send(new Calls.status({})), [refresh])
  const recent = useCall(() => control.Send(new Calls.events({ limit: 20 })), [
    refresh,
  ])
  const active = status.value?.active
  const events = [...(recent.value?.events ?? [])].reverse()

  return (
    <div className='grid gap-6'>
      {status.error && <Notice tone='error'>{status.error}</Notice>}
      <Panel
        title='Serving'
        description={status.loading
          ? 'Loading…'
          : active
          ? `Applied by ${active.author} on ${
            new Date(active.createdAt).toLocaleString()
          }`
          : 'Nothing has been applied yet'}
      >
        {active && (
          <div className='grid gap-3'>
            <InputCopy label='Revision' value={active.id} />
            {active.reason && (
              <p className='text-body text-muted-foreground'>{active.reason}</p>
            )}
            <InputCopy label='Manifest digest' value={active.manifest} />
          </div>
        )}
      </Panel>
      {active && <Doctor />}
      <Panel
        title='Recent events'
        description='What this orchestrator did since it started'
      >
        {recent.error && <Notice tone='error'>{recent.error}</Notice>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-28'>When</TableHead>
              <TableHead className='w-48'>Event</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event, i) => (
              <TableRow key={i} index={i}>
                <TableCell>{new Date(event.at).toLocaleTimeString()}</TableCell>
                <TableCell>{event.type}</TableCell>
                <TableCell className='max-w-md truncate font-mono text-caption'>
                  {JSON.stringify(event.data)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  )
}
