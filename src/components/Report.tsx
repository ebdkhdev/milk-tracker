import { useEffect, useRef } from 'react'
import { formatAge } from '#/lib/baby'
import type { Baby } from '#/lib/baby'
import { formatTime, parseDay, todayStr } from '#/lib/dates'
import type { Feed } from '#/lib/db'
import { useFormat } from '#/lib/format'
import { formatHM, summarize } from '#/components/Stats'
import type { DayRow } from '#/components/Stats'

type Props = {
  rows: DayRow[] // most recent first, as in the stats
  feeds: Feed[] // every feed; the report keeps those of the period
  baby: Baby
  period: 7 | 30
  avgIntervalMin: number | null
  onPeriod: (p: 7 | 30) => void
  onClose: () => void
  onShared: () => void
}

// Printable summary for a paediatrician visit. It replaces the main view (no overlay: simpler focus and
// scrolling on iOS); "Print or PDF" uses the browser's print, "Share as text" works where printing doesn't.
export function Report({ rows, feeds, baby, period, avgIntervalMin, onPeriod, onClose, onShared }: Props) {
  const { t, locale, formatAmount, unitLabel, mlToDisplay } = useFormat()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    titleRef.current?.focus()
  }, [])

  const days = rows.slice().reverse() // chronological for reading
  const first = days[0].date, last = days[days.length - 1].date
  const s = summarize(rows)
  const longDate = (ds: string) => parseDay(ds).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const shortDate = (ds: string) => parseDay(ds).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const today = todayStr(new Date())
  const showDiapers = days.some((r) => r.diapers > 0)
  const showSleep = days.some((r) => r.sleepMin > 0)
  const age = baby.birthDate ? formatAge(t, baby.birthDate, today) : null
  const notes = feeds
    .filter((f) => f.note && f.date >= first && f.date <= last)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))

  const summaryLines: [string, string][] = s
    ? [
        [t('statAvgDay'), formatAmount(s.avgDay)],
        [t('statPerDay'), String(Math.round(s.avgCount * 10) / 10)],
        [t('statAvgBottle'), formatAmount(s.avgBottle)],
        ...(avgIntervalMin !== null ? [[t('statInterval'), formatHM(avgIntervalMin) + ' ' + t('hourShort')] as [string, string]] : []),
        [s.shared !== null ? t('statDaysReached', { v: formatAmount(s.shared) }) : t('statDaysReachedVar'), s.reached + '/' + s.daysWithData],
        [t('statVitd'), s.vitd + '/' + s.days],
        ...(s.breastShare !== null ? [[t('statBreast'), s.breastShare + ' %'] as [string, string]] : []),
        ...(s.diapersPerDay !== null ? [[t('statDiapers'), String(Math.round(s.diapersPerDay * 10) / 10)] as [string, string]] : []),
        ...(s.sleepPerDay !== null ? [[t('statSleep'), formatHM(s.sleepPerDay) + ' ' + t('hourShort')] as [string, string]] : []),
      ]
    : []

  const asText = () => {
    const lines = [t('reportBtn'), t('reportPeriod', { from: longDate(first), to: longDate(last) })]
    if (age) lines.push(t('reportAge', { age }))
    lines.push('')
    summaryLines.forEach(([k, v]) => lines.push(k + ' : ' + v))
    lines.push('')
    days.forEach((r) => {
      const vit = r.daily && r.daily.vitaminD ? ' · ' + t('colVitd') + ' ✓' : ''
      lines.push(r.count
        ? `${shortDate(r.date)} : ${formatAmount(r.totalMl)}, ${t('bottles', { n: r.count })} (${t('minTarget', { v: formatAmount(r.minMl) })} ${r.totalMl >= r.minMl ? '✓' : '✗'})${vit}`
        : `${shortDate(r.date)} : —${vit}`)
    })
    if (notes.length) {
      lines.push('', t('reportNotes'))
      notes.forEach((f) => lines.push(`${shortDate(f.date)} ${formatTime(f.time)} (${formatAmount(f.ml)}${f.by ? ', ' + f.by : ''}) : ${f.note}`))
    }
    return lines.join('\n')
  }

  const share = () => {
    const text = asText()
    if (navigator.share) {
      navigator.share({ title: t('reportBtn'), text }).catch(() => {})
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(onShared).catch(() => {})
    }
  }

  return (
    <section className="report" id="report" aria-labelledby="report-title">
      <div className="report-bar">
        <button className="report-back" id="report-close" onClick={onClose}><span className="chev" aria-hidden="true">‹</span> {t('back')}</button>
        <div className="period-toggle" role="group" aria-label={t('period')}>
          {([7, 30] as const).map((p) => (
            <button key={p} id={'report-period-' + p} className={period === p ? 'active' : ''} onClick={() => onPeriod(p)}>
              {t('days' + p)}
            </button>
          ))}
        </div>
      </div>

      <div className="report-sheet">
        <h1 id="report-title" tabIndex={-1} ref={titleRef}>{t('reportBtn')}</h1>
        <p className="report-meta">
          {t('reportPeriod', { from: longDate(first), to: longDate(last) })}
          {age ? <><br />{t('reportAge', { age })}</> : null}
        </p>

        {s ? (
          <dl className="report-summary" id="report-summary">
            {summaryLines.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        ) : (
          <p className="report-meta">{t('reportNoData')}</p>
        )}

        {/* the table scrolls on its own if very large text makes it wider than the screen */}
        <div className="report-table-wrap">
        <table className="report-table" id="report-table">
          <thead>
            <tr>
              <th scope="col">{t('colDate')}</th>
              <th scope="col">{t('colTotal')} ({unitLabel})</th>
              <th scope="col">{t('colCount')}</th>
              <th scope="col">{t('colMin')}</th>
              <th scope="col">{t('colVitd')}</th>
              {showDiapers ? <th scope="col">{t('tab_diapers')}</th> : null}
              {showSleep ? <th scope="col">{t('tab_sleep')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {days.map((r) => (
              <tr key={r.date}>
                <th scope="row">{shortDate(r.date)}</th>
                <td>{r.count ? mlToDisplay(r.totalMl) : '—'}</td>
                <td>{r.count || '—'}</td>
                <td>
                  {mlToDisplay(r.minMl)}{' '}
                  {r.count ? <span className={r.totalMl >= r.minMl ? 'ok' : 'ko'}>{r.totalMl >= r.minMl ? '✓' : '✗'}</span> : null}
                </td>
                <td>{r.daily && r.daily.vitaminD ? '✓' : '—'}</td>
                {showDiapers ? <td>{r.diapers || '—'}</td> : null}
                {showSleep ? <td>{r.sleepMin ? formatHM(r.sleepMin) : '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {notes.length ? (
          <>
            <h2>{t('reportNotes')}</h2>
            <ul className="report-notes">
              {notes.map((f) => (
                <li key={f.id}>
                  <span className="report-note-when">{shortDate(f.date)} {formatTime(f.time)} · {formatAmount(f.ml)}{f.by ? ' · ' + f.by : ''}</span> {f.note}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="report-foot">{t('reportGenerated', { date: longDate(today) })}</p>
      </div>

      <div className="report-actions">
        <button className="data-btn primary" id="report-print" onClick={() => window.print()}>{t('print')}</button>
        <button className="data-btn" id="report-share" onClick={share}>{t('shareText')}</button>
      </div>
    </section>
  )
}
