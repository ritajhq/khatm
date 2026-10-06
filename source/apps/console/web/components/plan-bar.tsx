import { useState } from 'react'
import type { PlanView } from '@khatm/contract'
import { Calls } from '@khatm/contract/messages'
import {
  Button,
  CheckboxGroup,
  CheckboxItem,
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
import type { Checked } from '../draft.ts'
import { Notice } from './notice.tsx'
import { Panel } from './panel.tsx'
import { ImpactBadge } from './tones.tsx'

/**
 * Plan, then apply: the one way the console changes anything. The plan is
 * sent back with the revision it was made against, so a change that went
 * live in between is refused rather than overwritten.
 */
export function PlanBar(
  { checked, onApplied }: { checked: Checked; onApplied(): void },
) {
  const control = useControl()
  const SearchIcon = useIcon('search')
  const CheckIcon = useIcon('check')
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
      setPlan(
        await control.Send(new Calls.plan({ manifest: checked.authored })),
      )
      setPlanned(current)
      setConfirmed(false)
    } catch (e) {
      setError(Describe(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!checked.ok || !plan) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await control.Send(
        new Calls.apply({
          manifest: checked.authored,
          base: plan.base,
          confirmed,
        }),
      )
      setDone(
        result.changed
          ? `Applied as revision ${result.revision.id}`
          : 'Nothing to apply',
      )
      setPlan(undefined)
      onApplied()
    } catch (e) {
      setError(Describe(e))
    } finally {
      setBusy(false)
    }
  }

  const canApply = plan && !stale && !plan.isEmpty && !plan.isBlocked &&
    (!plan.needsConfirmation || confirmed) && !busy

  return (
    <Panel
      title='Plan and apply'
      description={checked.ok
        ? 'The draft is valid. Plan it to see what applying would change.'
        : 'Fix the draft before planning.'}
      action={
        <div className='flex gap-2'>
          <Button
            variant='secondary'
            size='compact'
            leadingIcon={SearchIcon}
            disabled={!checked.ok || busy}
            onClick={makePlan}
          >
            Plan
          </Button>
          <Button
            variant='primary'
            size='compact'
            leadingIcon={CheckIcon}
            loading={busy && plan !== undefined}
            disabled={!canApply}
            onClick={apply}
          >
            Apply
          </Button>
        </div>
      }
    >
      {!checked.ok && (
        <Notice tone='error' details={checked.problems.join('; ')}>
          The draft has problems
        </Notice>
      )}
      {error && <Notice tone='error'>{error}</Notice>}
      {done && <Notice tone='success'>{done}</Notice>}
      {stale && (
        <Notice tone='warning'>
          The draft changed since this plan. Plan again.
        </Notice>
      )}
      {plan && !stale && plan.isEmpty && <Notice>No changes.</Notice>}
      {plan && !stale && !plan.isEmpty && (
        <>
          <p className='flex items-center gap-2 text-body text-muted-foreground'>
            Against {plan.base ? `revision ${plan.base}` : 'a fresh install'}:
            <ImpactBadge impact={plan.impact} />
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-32'>Impact</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.steps.map((step, i) => (
                <TableRow key={`${step.path}-${i}`} index={i}>
                  <TableCell>
                    <ImpactBadge impact={step.impact} />
                  </TableCell>
                  <TableCell className='font-mono text-caption'>
                    {step.path || '(whole manifest)'}
                  </TableCell>
                  <TableCell>{step.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {plan.isBlocked && (
            <Notice tone='error'>
              Blocked: do the manual steps above, then plan again.
            </Notice>
          )}
          {plan.needsConfirmation && (
            <CheckboxGroup
              checkedIndices={confirmed ? new Set([0]) : new Set()}
            >
              <CheckboxItem
                index={0}
                label='I understand the destructive changes above'
                checked={confirmed}
                onToggle={() => setConfirmed(!confirmed)}
              />
            </CheckboxGroup>
          )}
        </>
      )}
    </Panel>
  )
}
