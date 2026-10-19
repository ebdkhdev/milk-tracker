import { formatAge } from '#/lib/baby'
import { useFormat } from '#/lib/format'

const RING_R = 52

type Props = {
  totalMl: number
  count: number
  dateStr: string
  minMl: number
  birthDate: string | null
  lastFeed: string | null
  rhythm: string | null
}

// minMl is the minimum for the viewed day (dateStr); with a birth date the baby's age that day is shown next to it.
export function TotalCard({ totalMl, count, dateStr, minMl, birthDate, lastFeed, rhythm }: Props) {
  const { t, unitLabel, mlToDisplay, formatAmount } = useFormat()
  const age = birthDate ? formatAge(t, birthDate, dateStr) : null
  const reached = totalMl >= minMl
  const pct = Math.min(100, Math.round((totalMl / minMl) * 100))
  const extra = totalMl - minMl
  const cls = 'total-card' + (reached ? ' reached' : totalMl > 0 ? ' under' : '')

  // progress ring: the day's bottle filling up towards the minimum
  const circumference = 2 * Math.PI * RING_R
  return (
    <div className={cls}>
      <div className="ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="ring-track" cx="60" cy="60" r={RING_R} strokeWidth="11" />
          <circle
            className="ring-fill"
            id="goal-fill"
            cx="60"
            cy="60"
            r={RING_R}
            strokeWidth="11"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
            style={{ opacity: pct > 0 ? 1 : 0 }}
          />
        </svg>
        <div className="ring-center">
          <div>
            <span className="total-number" id="total-number">{mlToDisplay(totalMl)}</span>
            <span className="total-unit" id="total-unit-label">{unitLabel}</span>
          </div>
          <div className="total-sub" id="total-sub">{count === 0 ? t('noFeedsYet') : t('bottles', { n: count })}</div>
        </div>
      </div>
      <div className="goal-status" id="goal-status">
        {reached
          ? extra > 0
            ? t('goalReachedExtra', { v: formatAmount(extra) })
            : t('goalReached')
          : t('goalRemaining', { v: formatAmount(minMl - totalMl) })}
      </div>
      <div className="goal-meta">
        <span>0</span>
        <span id="goal-target">{age ? t('minTargetAge', { v: formatAmount(minMl), age }) : t('minTarget', { v: formatAmount(minMl) })}</span>
      </div>
      {lastFeed ? <div className="last-feed" id="last-feed">{lastFeed}</div> : null}
      {rhythm ? <div className="last-feed" id="rhythm">{rhythm}</div> : null}
    </div>
  )
}
