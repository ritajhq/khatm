import { useState } from 'react'
import type { FindingView } from '@khatm/contract'
import { Calls } from '@khatm/contract/messages'
import {
  Button,
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
import { Notice } from './notice.tsx'
import { Panel } from './panel.tsx'
import { SeverityBadge } from './tones.tsx'

/** `khatm doctor` for the serving revision, on demand: it reaches the database and URLs. */
export function Doctor() {
  const control = useControl()
  const PlayIcon = useIcon('play')
  const [findings, setFindings] = useState<FindingView[] | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function run() {
    setBusy(true)
    setError(undefined)
    try {
      setFindings((await control.Send(new Calls.doctor({}))).findings)
    } catch (e) {
      setError(Describe(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title='Doctor'
      description='Secrets, database, worker, URLs and cookies, as the orchestrator sees them.'
      action={
        <Button
          variant='secondary'
          size='compact'
          leadingIcon={PlayIcon}
          loading={busy}
          onClick={run}
        >
          Run checks
        </Button>
      }
    >
      {error && <Notice tone='error'>{error}</Notice>}
      {findings && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-20'>Result</TableHead>
              <TableHead className='w-40'>Check</TableHead>
              <TableHead>Finding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {findings.map((finding, i) => (
              <TableRow key={i} index={i}>
                <TableCell>
                  <SeverityBadge severity={finding.severity} />
                </TableCell>
                <TableCell className='font-mono text-caption'>
                  {finding.check}
                </TableCell>
                <TableCell>{finding.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}
