import { useState } from 'react'
import type { BabyInfo } from '#/lib/baby'
import { parseDay, todayStr } from '#/lib/dates'
import type { EventRecord } from '#/lib/db'
import { useFormat } from '#/lib/format'
import { CURVES, MAX_MONTHS, RANGES, ageMonths, lmsAt, percentile, valueAtZ } from '#/lib/growth'
import type { Measure } from '#/lib/growth'

const FIELD: Record<Measure, 'weightKg' | 'lengthCm' | 'headCm'> = { weight: 'weightKg', length: 'lengthCm', head: 'headCm' }
const MEASURES: Measure[] = ['weight', 'length', 'head']
export type GrowthInput = { date: string; weightKg?: number; lengthCm?: number; headCm?: number }

type Props = {
  baby: BabyInfo
  measurements: EventRecord[] // type "growth", newest first
  onAdd: (m: GrowthInput) => void
  onDelete: (e: EventRecord) => void
}

// Weight, length and head circumference over time, against the WHO standards when the birth date and sex
// are known (0-24 months). The list doubles as the text alternative of the chart.
export function Growth({ baby, measurements, onAdd, onDelete }: Props) {
  const { t, locale } = useFormat()
  const [measure, setMeasure] = useState<Measure>('weight')
  const [form, setForm] = useState({ date: todayStr(new Date()), weight: '', length: '', head: '' })
  const [error, setError] = useState<string | null>(null)
  const canCompare = !!(baby.birthDate && baby.sex)
  const num = (v: number, digits: number) => v.toLocaleString(locale, { maximumFractionDigits: digits })
  const pctOf = (m: Measure, e: EventRecord) => {
    const v = Number(e[FIELD[m]])
    return canCompare && v > 0 ? percentile(m, baby.sex, ageMonths(baby.birthDate!, e.date), v) : null
  }

  const submit = () => {
    const values: GrowthInput = { date: form.date }
    for (const m of MEASURES) {
      const raw = form[m].replace(',', '.').trim()
      if (!raw) continue
      const v = Number(raw)
      const [min, max] = RANGES[m]
      if (!(v >= min && v <= max)) { setError(t('growthRange', { what: t('measure_' + m), min, max })); return }
      values[FIELD[m]] = v
    }
    if (!values.weightKg && !values.lengthCm && !values.headCm) { setError(t('growthNeedOne')); return }
    setError(null)
    onAdd(values)
    setForm({ ...form, weight: '', length: '', head: '' })
  }

  return (
    <>
      <div className="section-head">
        <p className="section-label">{t('tab_growth')}</p>
        <div className="milk-toggle" role="group" aria-label={t('growthMeasure')}>
          {MEASURES.map((m) => (
            <button key={m} id={'growth-' + m} className={m === measure ? 'active' : ''} aria-pressed={m === measure} onClick={() => setMeasure(m)}>
              {t('measure_' + m)}
            </button>
          ))}
        </div>
      </div>
      <div className="card growth-card">
        {canCompare ? (
          <GrowthChart baby={baby} measure={measure} measurements={measurements} />
        ) : (
          <p className="settings-note" id="growth-no-curves">{t('growthNoCurves')}</p>
        )}
        <p className="settings-note">{t('growthNote')}</p>
      </div>

      <p className="section-label">{t('growthAdd')}</p>
      <div className="card sleep-add" id="growth-form">
        <label className="care-time"><span>{t('growthDate')}</span><input type="date" id="growth-date" max={todayStr(new Date())} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value || todayStr(new Date()) })} /></label>
        {MEASURES.map((m) => (
          <label key={m} className="care-time">
            <span>{t('growthField_' + m)}</span>
            {/* text + decimal keyboard: a number field returns "" for "6,2" with a French locale, losing the value */}
            <input type="text" inputMode="decimal" autoComplete="off" className="growth-input" id={'growth-in-' + m} value={form[m]} onChange={(e) => setForm({ ...form, [m]: e.target.value })} />
          </label>
        ))}
        <button className="data-btn primary" id="growth-add" onClick={submit}>{t('growthSave')}</button>
        {error ? <p className="settings-note share-error" id="growth-error" role="alert">{error}</p> : null}
      </div>

      <p className="section-label">{t('growthList')}</p>
      <ul className="feed-list" id="growth-list">
        {measurements.length === 0 ? (
          <div className="empty">{t('growthEmpty')}</div>
        ) : (
          measurements.map((e) => (
            <li key={e.id} className="feed-item">
              <div className="left growth-row">
                <span className="amt">{parseDay(e.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span className="time growth-values">
                  {MEASURES.filter((m) => Number(e[FIELD[m]]) > 0).map((m) => {
                    const p = pctOf(m, e)
                    return (
                      <span key={m} className={'growth-value growth-' + m}>
                        {num(Number(e[FIELD[m]]), m === 'weight' ? 2 : 1)} {t(m === 'weight' ? 'kg' : 'cm')}{p !== null ? ' · ' + t('pct', { p }) : ''}
                      </span>
                    )
                  })}
                </span>
              </div>
              <div className="actions">
                <button className="del" onClick={() => onDelete(e)}>{t('del')}</button>
              </div>
            </li>
          ))
        )}
      </ul>
    </>
  )
}

// SVG chart: the five WHO percentile curves for the baby's sex, and the measurements as dots.
function GrowthChart({ baby, measure, measurements }: { baby: BabyInfo; measure: Measure; measurements: EventRecord[] }) {
  const { t, locale } = useFormat()
  const points = measurements
    .filter((e) => Number(e[FIELD[measure]]) > 0)
    .map((e) => ({ x: ageMonths(baby.birthDate!, e.date), y: Number(e[FIELD[measure]]) }))
    .filter((p) => p.x >= 0 && p.x <= MAX_MONTHS)
  const ageNow = ageMonths(baby.birthDate!, todayStr(new Date()))
  if (ageNow > MAX_MONTHS + 1 && !points.length) return <p className="settings-note" id="growth-beyond">{t('growthBeyond')}</p>
  // the x range follows the baby's age (at least 6 months, at most 24), so recent months stay readable
  const xMax = Math.min(MAX_MONTHS, Math.max(6, Math.ceil(Math.max(ageNow, ...points.map((p) => p.x))) + 1))
  const curve = (z: number) => {
    const out: [number, number][] = []
    for (let x = 0; x <= xMax + 1e-9; x += 0.25) out.push([x, valueAtZ(lmsAt(measure, baby.sex, x)!, z)])
    return out
  }
  const curves = CURVES.map((c) => ({ ...c, pts: curve(c.z) }))
  const ys = [...curves.flatMap((c) => c.pts.map((p) => p[1])), ...points.map((p) => p.y)]
  const yMin = Math.floor(Math.min(...ys)), yMax = Math.ceil(Math.max(...ys))
  const W = 340, H = 220, L = 34, R = 30, T = 10, B = 26
  const sx = (x: number) => L + (x / xMax) * (W - L - R)
  const sy = (y: number) => T + (1 - (y - yMin) / (yMax - yMin)) * (H - T - B)
  const xStep = xMax <= 6 ? 1 : xMax <= 12 ? 2 : 3
  const yStep = Math.max(1, Math.ceil((yMax - yMin) / 6))
  const unit = t(measure === 'weight' ? 'kg' : 'cm')
  return (
    <div className="growth-chart" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('growthChart', { what: t('measure_' + measure) })} id="growth-chart">
        {Array.from({ length: Math.floor((yMax - yMin) / yStep) + 1 }, (_, i) => yMin + i * yStep).map((y) => (
          <g key={'y' + y}>
            <line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} className="grid" />
            <text x={L - 4} y={sy(y) + 3} className="axis" textAnchor="end">{y}</text>
          </g>
        ))}
        {Array.from({ length: Math.floor(xMax / xStep) + 1 }, (_, i) => i * xStep).map((x) => (
          <text key={'x' + x} x={sx(x)} y={H - 8} className="axis" textAnchor="middle">{x}</text>
        ))}
        <text x={W - R} y={H - 8} className="axis" textAnchor="start" dx="4">{t('monthsShort')}</text>
        <text x={L - 4} y={T - 1} className="axis" textAnchor="end">{unit}</text>
        {curves.map((c) => (
          <g key={c.p}>
            <polyline points={c.pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} className={'curve' + (c.p === 50 ? ' median' : c.p === 3 || c.p === 97 ? ' outer' : '')} />
            <text x={W - R + 3} y={sy(c.pts[c.pts.length - 1][1]) + 3} className="axis curve-label">{c.p}</text>
          </g>
        ))}
        {points.length > 1 ? <polyline points={points.sort((a, b) => a.x - b.x).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} className="baby-line" /> : null}
        {points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4" className="baby-point"><title>{p.y.toLocaleString(locale)} {unit}</title></circle>)}
      </svg>
    </div>
  )
}
