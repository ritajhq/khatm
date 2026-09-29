import { useEffect, useState } from 'react'
import type { PlanView, RevisionView } from '@khatm/contract'
import {
  Alert,
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
import { api, ControlError, describeError } from '../api.ts'

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

export function Revisions(
  { refresh, onChanged }: { refresh: number; onChanged(): void },
) {
  const [revisions, setRevisions] = useState<RevisionView[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState<
    { revision: string; steps: PlanView['steps'] } | undefined
  >()
  const [message, setMessage] = useState<string | undefined>()

  useEffect(() => {
    Promise.all([api.history({ limit: 50 }), api.status({})])
      .then(([history, status]) => {
        setRevisions(history.revisions)
        setActive(status.active?.id)
      })
      .catch((e) => setError(describeError(e)))
  }, [refresh])

  async function rollback(revision: string, confirmed: boolean) {
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await api.rollback({ revision, confirmed })
      setPending(undefined)
      setMessage(`Rolled back as revision ${result.revision.id}`)
      onChanged()
    } catch (e) {
      if (e instanceof ControlError && e.code === 'confirmation_required') {
        setPending({ revision, steps: e.body.steps ?? [] })
        return
      }
      setError(describeError(e))
    }
  }

  async function exportManifest(revision: string) {
    try {
      const { files } = await api.export({ revision })
      download(
        `khatm-${revision}.json`,
        files['manifest.authored.json'] ?? files['manifest.json'],
      )
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <Card>
      <CardHeader className='text-left'>
        <CardTitle className='text-base'>Revisions</CardTitle>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {error && <Alert tone='destructive'>{error}</Alert>}
        {message && <Alert>{message}</Alert>}
        {pending && (
          <Alert tone='destructive'>
            <p>Rolling back to {pending.revision} is destructive:</p>
            <ul className='list-disc pl-4'>
              {pending.steps.map((s, i) => (
                <li key={i}>{s.path}: {s.reason}</li>
              ))}
            </ul>
            <div className='mt-2 flex gap-2'>
              <Button
                size='sm'
                onClick={() => rollback(pending.revision, true)}
              >
                Roll back anyway
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => setPending(undefined)}
              >
                Cancel
              </Button>
            </div>
          </Alert>
        )}
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
            {revisions.map((revision) => (
              <TableRow key={revision.id}>
                <TableCell className='font-mono text-xs'>
                  {revision.id.slice(0, 8)}
                  {revision.id === active && ' (serving)'}
                </TableCell>
                <TableCell>
                  {new Date(revision.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>{revision.author}</TableCell>
                <TableCell className='text-muted-foreground'>
                  {revision.reason}
                </TableCell>
                <TableCell className='flex justify-end gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => exportManifest(revision.id)}
                  >
                    Download
                  </Button>
                  {revision.id !== active && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => rollback(revision.id, false)}
                    >
                      Roll back
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
