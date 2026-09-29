import { useState } from 'react'
import type { FindingView } from '@khatm/contract'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@khatm-libs/ui'
import { api, describeError } from '../api.ts'

const TONE = {
  ok: 'secondary',
  info: 'outline',
  warn: 'default',
  fail: 'destructive',
} as const

/** `khatm doctor` for the serving revision, on demand: it reaches the database and URLs. */
export function Doctor() {
  const [findings, setFindings] = useState<FindingView[] | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function run() {
    setBusy(true)
    setError(undefined)
    try {
      setFindings((await api.doctor({})).findings)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between text-left'>
        <div className='grid gap-1.5'>
          <CardTitle className='text-base'>Doctor</CardTitle>
          <CardDescription>
            Secrets, database, worker, URLs and cookies, as the orchestrator
            sees them.
          </CardDescription>
        </div>
        <Button size='sm' variant='outline' disabled={busy} onClick={run}>
          {busy ? 'Checking…' : 'Run checks'}
        </Button>
      </CardHeader>
      {(findings || error) && (
        <CardContent className='grid gap-2 text-sm'>
          {error && <Alert tone='destructive'>{error}</Alert>}
          {findings?.map((finding, i) => (
            <div key={i} className='flex items-start gap-3'>
              <Badge
                variant={TONE[finding.severity]}
                className='w-12 justify-center'
              >
                {finding.severity}
              </Badge>
              <span className='w-32 shrink-0 font-mono text-xs leading-5'>
                {finding.check}
              </span>
              <span>{finding.message}</span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
