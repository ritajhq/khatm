import { useState } from 'react'
import type { PlanView } from '@khatm/contract'
import { Calls, Rejected } from '@khatm/contract/messages'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  useIcon,
} from '@khatm-libs/ui'
import { Describe } from '../control.ts'
import { useControl } from '../control-provider.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'
import { ImpactBadge } from '../components/tones.tsx'
import { useCall } from '../use-call.ts'

function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/** Every applied manifest; any of them can be downloaded or rolled back to. */
export function Revisions(
  { refresh, onChanged }: { refresh: number; onChanged(): void },
) {
  const control = useControl()
  const ArrowDownIcon = useIcon('arrow-down')
  const RotateIcon = useIcon('rotate-ccw')
  const history = useCall(
    () =>
      Promise.all([
        control.Send(new Calls.history({ limit: 50 })),
        control.Send(new Calls.status({})),
      ]),
    [refresh],
  )
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState<
    { revision: string; steps: PlanView['steps'] } | undefined
  >()
  const [message, setMessage] = useState<string | undefined>()
  const revisions = history.value?.[0].revisions ?? []
  const active = history.value?.[1].active?.id

  async function rollback(revision: string, confirmed: boolean) {
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await control.Send(
        new Calls.rollback({ revision, confirmed }),
      )
      setPending(undefined)
      setMessage(`Rolled back as revision ${result.revision.id}`)
      onChanged()
    } catch (e) {
      if (e instanceof Rejected && e.Code === 'confirmation_required') {
        setPending({ revision, steps: e.Steps })
        return
      }
      setError(Describe(e))
    }
  }

  async function exportManifest(revision: string) {
    try {
      const { files } = await control.Send(new Calls.export({ revision }))
      download(
        `khatm-${revision}.json`,
        files['manifest.authored.json'] ?? files['manifest.json'],
      )
    } catch (e) {
      setError(Describe(e))
    }
  }

  return (
    <Panel
      title='Revisions'
      description='Newest first. Rolling back applies an earlier manifest as a new revision.'
    >
      {(error ?? history.error) && (
        <Notice tone='error'>{error ?? history.error}</Notice>
      )}
      {message && <Notice tone='success'>{message}</Notice>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Revision</TableHead>
            <TableHead>When</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {revisions.map((revision, i) => (
            <TableRow key={revision.id} index={i}>
              <TableCell className='font-mono text-caption'>
                <span className='flex items-center gap-2'>
                  <Tooltip content={revision.id}>
                    <span>{revision.id.slice(0, 8)}</span>
                  </Tooltip>
                  {revision.id === active && (
                    <Badge color='green'>(serving)</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>
                {new Date(revision.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>{revision.author}</TableCell>
              <TableCell>{revision.reason}</TableCell>
              <TableCell>
                <div className='flex justify-end gap-2'>
                  <Button
                    variant='ghost'
                    size='compact'
                    leadingIcon={ArrowDownIcon}
                    onClick={() => exportManifest(revision.id)}
                  >
                    Download
                  </Button>
                  {revision.id !== active && (
                    <Button
                      variant='secondary'
                      size='compact'
                      leadingIcon={RotateIcon}
                      onClick={() => rollback(revision.id, false)}
                    >
                      Roll back
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={pending !== undefined}
        onOpenChange={(open) => !open && setPending(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Roll back to {pending?.revision.slice(0, 8)}?
            </DialogTitle>
            <DialogDescription>
              Rolling back to {pending?.revision} is destructive:
            </DialogDescription>
          </DialogHeader>
          <ul className='grid gap-2 text-body'>
            {pending?.steps.map((step, i) => (
              <li key={i} className='flex items-start gap-2'>
                <ImpactBadge impact={step.impact} />
                <span>
                  <span className='font-mono text-caption'>{step.path}</span>:
                  {' '}
                  {step.reason}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant='secondary' onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={() => pending && rollback(pending.revision, true)}
            >
              Roll back anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
