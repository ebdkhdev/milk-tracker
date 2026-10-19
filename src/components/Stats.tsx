import type { ReactNode } from 'react'
import { isToday, parseDay } from '#/lib/dates'
import type { Daily } from '#/lib/db'
import { useFormat } from '#/lib/format'
import { DAILY_MIN_ML } from '#/lib/settings'

// Per-day aggregates for the selected period, most recent day first.
export type DayRow = { date: string; totalMl: number; count: number; daily: Daily | null }

type Props = {
  rows: DayRow[]
  period: 7 | 30
  viewing: string
  onPeriod: (p: 7 | 30) => void
  onOpen: (dateStr: string) => void
}

export function Stats({ rows, period, viewing, onPeriod, onOpen }: Props) {
  const { t, formatAmount } = useFormat()
  return (
    <>
      <div className="section-head">
        <p className="section-label">{t('stats')}</p>
        <div className="period-toggle" role="group" aria-label={t('period')}>
          {([7, 30] as const).map((p) => (
            <button key={p} id={'period-' + p} className={period === p ? 'active' : ''} onClick={() => onPeriod(p)}>
              {t('days' + p)}
            </button>
          ))}
        </div>
      </div>
      <StatTiles rows={rows} />

      <p className="section-label" id="history-label">{t('historyLabel', { v: formatAmount(DAILY_MIN_ML) })}</p>
      <History rows={rows} viewing={viewing} onOpen={onOpen} />
    </>
  )
}

function Tile({ value, unit, label, cls }: { value: ReactNode; unit?: string; label: string; cls?: string }) {
  return (
    <div className={'stat' + (cls ? ' ' + cls : '')}>
      <div className="sv">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      <div className="sl">{label}</div>
    </div>
  )
}

// Averages are over days that have at least one feed; vitamin D is counted over the whole period.
function StatTiles({ rows }: { rows: DayRow[] }) {
  const { t, locale, unitLabel: u, mlToDisplay, formatAmount } = useFormat()
  const withData = rows.filter((r) => r.count > 0)
  const n = withData.length
  if (n === 0) {
    return (
      <>
        <div className="stats-grid" id="stats-grid"></div>
        <p className="stats-note" id="stats-note">{t('statsEmpty', { n: rows.length })}</p>
      </>
    )
  }
  let sumMl = 0, sumCount = 0, reached = 0, best = 0
  let bestDay: string | null = null
  withData.forEach((r) => {
    sumMl += r.totalMl
    sumCount += r.count
    if (r.totalMl >= DAILY_MIN_ML) reached++
    if (r.totalMl > best) { best = r.totalMl; bestDay = r.date }
  })
  const vitd = rows.filter((r) => r.daily && r.daily.vitaminD).length
  const days = rows.length
  const avgDay = sumMl / n
  const avgBottle = sumCount ? sumMl / sumCount : 0
  const avgCount = sumCount / n
  const bestLabel = bestDay ? parseDay(bestDay).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''

  return (
    <>
      <div className="stats-grid" id="stats-grid">
        <Tile value={mlToDisplay(avgDay)} unit={u} label={t('statAvgDay')} cls={avgDay >= DAILY_MIN_ML ? 'good' : 'bad'} />
        <Tile
          value={reached + '/' + n}
          label={t('statDaysReached', { v: formatAmount(DAILY_MIN_ML) })}
          cls={reached === n ? 'good' : reached < n / 2 ? 'bad' : ''}
        />
        <Tile value={Math.round(avgCount * 10) / 10} label={t('statPerDay')} />
        <Tile value={mlToDisplay(avgBottle)} unit={u} label={t('statAvgBottle')} />
        <Tile
          value={vitd + '/' + days}
          label={t('statVitd')}
          cls={vitd === days ? 'good' : vitd < days / 2 ? 'bad' : ''}
        />
        <Tile value={mlToDisplay(best)} unit={u} label={t('statBest', { date: bestLabel })} />
      </div>
      <p className="stats-note" id="stats-note">{t('statsNote', { n, total: days })}</p>
    </>
  )
}

function History({ rows, viewing, onOpen }: { rows: DayRow[]; viewing: string; onOpen: (d: string) => void }) {
  const { t, locale, formatAmount } = useFormat()
  // scale leaves ~10% headroom so the minimum marker never sits on the edge
  const max = Math.max(...rows.map((r) => r.totalMl), DAILY_MIN_ML) * 1.1
  return (
    <div className="history" id="history">
      {rows.map((r) => {
        const d = parseDay(r.date)
        const today = isToday(r.date)
        const vitGiven = !!(r.daily && r.daily.vitaminD)
        return (
          <div
            key={r.date}
            className={'history-row' + (today ? ' today' : '') + (r.date === viewing ? ' viewing' : '')}
            title={t('openDay', { date: d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}
            onClick={() => onOpen(r.date)}
          >
            <div className="hlabel">
              {today
                ? t('todayShort')
                : d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '') + ' ' + d.getDate()}
            </div>
            <div className={'hdot' + (vitGiven ? ' done' : '')} title={vitGiven ? t('vitdDotGiven') : t('vitdDotNot')}></div>
            <div className="bar-track">
              <div
                className={'bar-fill' + (r.totalMl >= DAILY_MIN_ML ? ' reached' : '')}
                style={{ width: (max > 0 ? Math.round((r.totalMl / max) * 100) : 0) + '%' }}
              ></div>
              <div
                className="bar-goal"
                style={{ insetInlineStart: Math.round((DAILY_MIN_ML / max) * 100) + '%' }}
                title={t('minMarker', { v: formatAmount(DAILY_MIN_ML) })}
              ></div>
            </div>
            <div className="hval">{r.totalMl > 0 ? formatAmount(r.totalMl) : '—'}</div>
          </div>
        )
      })}
    </div>
  )
}
