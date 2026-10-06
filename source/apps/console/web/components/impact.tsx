import type { PlanView } from '@khatm/contract'
import { Badge } from '@khatm-libs/ui'

type Impact = PlanView['impact']

const VARIANT: Record<
  Impact,
  'secondary' | 'outline' | 'default' | 'destructive'
> = {
  hot: 'secondary',
  restart: 'outline',
  migration: 'default',
  manual: 'destructive',
  destructive: 'destructive',
}

export function ImpactBadge({ impact }: { impact: Impact }) {
  return <Badge variant={VARIANT[impact]}>{impact}</Badge>
}
