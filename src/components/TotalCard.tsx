import { formatAge } from '#/lib/baby'
import { useFormat } from '#/lib/format'

type Props = { totalMl: number; count: number; dateStr: string; minMl: number; birthDate: string | null }

// minMl is the minimum for the viewed day (dateStr); with a birth date the baby's age that day is shown next to it.
export function TotalCard({ totalMl, count, dateStr, minMl, birthDate }: Props) {
  const { t, unitLabel, mlToDisplay, formatAmount } = useFormat()
  const age = birthDate ? formatAge(t, birthDate, dateStr) : null
  const reached = totalMl >= minMl
  const pct = Math.min(100, Math.round((totalMl / minMl) * 100))
  const extra = totalMl - minMl
  const cls = 'total-card' + (reached ? ' reached' : totalMl > 0 ? ' under' : '')

  return (
    <div className={cls}>
      <div>
        <span className="total-number" id="total-number">{mlToDisplay(totalMl)}</span>
        <span className="total-unit" id="total-unit-label">{unitLabel}</span>
      </div>
      <div className="total-sub" id="total-sub">{count === 0 ? t('noFeedsYet') : t('bottles', { n: count })}</div>
      <div className="goal-track" aria-hidden="true">
        <div className="goal-fill" id="goal-fill" style={{ width: pct + '%' }}></div>
      </div>
      <div className="goal-meta">
        <span>0</span>
        <span id="goal-target">{age ? t('minTargetAge', { v: formatAmount(minMl), age }) : t('minTarget', { v: formatAmount(minMl) })}</span>
      </div>
      <div className="goal-status" id="goal-status">
        {reached
          ? extra > 0
            ? t('goalReachedExtra', { v: formatAmount(extra) })
            : t('goalReached')
          : t('goalRemaining', { v: formatAmount(minMl - totalMl) })}
      </div>
    </div>
  )
}
