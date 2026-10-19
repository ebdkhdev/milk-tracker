import { DAILY_MIN_ML } from '#/lib/settings'
import { useFormat } from '#/lib/format'

export function TotalCard({ totalMl, count }: { totalMl: number; count: number }) {
  const { t, unitLabel, mlToDisplay, formatAmount } = useFormat()
  const reached = totalMl >= DAILY_MIN_ML
  const pct = Math.min(100, Math.round((totalMl / DAILY_MIN_ML) * 100))
  const extra = totalMl - DAILY_MIN_ML
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
        <span id="goal-target">{t('minTarget', { v: formatAmount(DAILY_MIN_ML) })}</span>
      </div>
      <div className="goal-status" id="goal-status">
        {reached
          ? extra > 0
            ? t('goalReachedExtra', { v: formatAmount(extra) })
            : t('goalReached')
          : t('goalRemaining', { v: formatAmount(DAILY_MIN_ML - totalMl) })}
      </div>
    </div>
  )
}
