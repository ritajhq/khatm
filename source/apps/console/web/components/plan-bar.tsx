import { useState } from 'react'
import type { PlanView } from '@khatm/contract'
import {
  Alert,
  Button,
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
import type { Checked } from '../draft.ts'
import { ImpactBadge } from './impact.tsx'

/**
 * Plan, then apply: the one way the console changes anything. The plan is
 * sent back with the revision it was made against, so a change that went
 * live in between is refused rather than overwritten.
 */
export function PlanBar(
  { checked, onApplied }: { checked: Checked; onApplied(): void },
) {
  const [plan, setPlan] = useState<PlanView | undefined>()
  const [planned, setPlanned] = useState<string | undefined>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [done, setDone] = useState<string | undefined>()

  const current = checked.ok ? JSON.stringify(checked.authored) : undefined
  const stale = plan !== undefined && planned !== current

  async function makePlan() {
    if (!checked.ok) return
    setBusy(true)
    setError(undefined)
    setDone(undefined)
    try {
      setPlan(await api.plan({ manifest: checked.authored }))
      setPlanned(current)
      setConfirmed(false)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!checked.ok || !plan) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await api.apply({
        manifest: checked.authored,
        base: plan.base,
        confirmed,
      })
      setDone(
        result.changed
          ? `Applied as revision ${result.revision.id}`
          : 'Nothing to apply',
      )
      setPlan(undefined)
      onApplied()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className='text-left'>
        <CardTitle className='text-base'>Plan and apply</CardTitle>
        <CardDescription>
          {checked.ok
            ? 'The draft is valid. Plan it to see what applying would change.'
            : 'Fix the draft before planning.'}
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {!checked.ok && (
          <Alert tone='destructive'>
            <ul className='list-disc pl-4'>
              {checked.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </Alert>
        )}
        {error && <Alert tone='destructive'>{error}</Alert>}
        {done && <Alert>{done}</Alert>}
        {plan && !stale && (
          plan.isEmpty ? <Alert>No changes.</Alert> : (
            <>
              <p className='text-sm'>
                Against{' '}
                {plan.base ? `revision ${plan.base}` : 'a fresh install'}:{' '}
                <ImpactBadge impact={plan.impact} />
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Impact</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.steps.map((step, i) => (
                    <TableRow key={`${step.path}-${i}`}>
                      <TableCell>
                        <ImpactBadge impact={step.impact} />
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {step.path || '(whole manifest)'}
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {step.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {plan.isBlocked && (
                <Alert tone='destructive'>
                  Blocked: do the manual steps above, then plan again.
                </Alert>
              )}
              {plan.needsConfirmation && (
                <label className='flex items-center gap-2 text-sm'>
                  <input
                    type='checkbox'
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.currentTarget.checked)}
                  />
                  I understand the destructive changes above
                </label>
              )}
            </>
          )
        )}
        {stale && <Alert>The draft changed since this plan. Plan again.</Alert>}
        <div className='flex gap-2'>
          <Button
            variant='outline'
            disabled={!checked.ok || busy}
            onClick={makePlan}
          >
            Plan
          </Button>
          <Button
            disabled={!plan || stale || plan.isEmpty || plan.isBlocked ||
              (plan.needsConfirmation && !confirmed) || busy}
            onClick={apply}
          >
            Apply
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
