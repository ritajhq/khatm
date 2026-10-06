import type { FindingView, PlanView } from '@khatm/contract'
import { Badge, type badgeColors } from '@khatm-libs/ui'

type Color = keyof typeof badgeColors

const IMPACT: Readonly<Record<PlanView['impact'], Color>> = {
  hot: 'green',
  restart: 'blue',
  migration: 'amber',
  manual: 'orange',
  destructive: 'red',
}

const SEVERITY: Readonly<Record<FindingView['severity'], Color>> = {
  ok: 'green',
  info: 'blue',
  warn: 'amber',
  fail: 'red',
}

/** How disruptive applying a change is. */
export function ImpactBadge({ impact }: { impact: PlanView['impact'] }) {
  return <Badge variant='dot' color={IMPACT[impact]}>{impact}</Badge>
}

/** How a doctor check came out. */
export function SeverityBadge(
  { severity }: { severity: FindingView['severity'] },
) {
  return <Badge color={SEVERITY[severity]}>{severity}</Badge>
}
