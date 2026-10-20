import { formatTime } from '#/lib/dates'
import type { EventRecord } from '#/lib/db'
import { useFormat } from '#/lib/format'

export type DiaperKind = 'wet' | 'dirty' | 'both'
const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']
const ICON: Record<DiaperKind, string> = { wet: '💧', dirty: '💩', both: '💧💩' }

// counts for a list of diaper events: "both" counts as wet and as dirty
export function diaperCounts(list: EventRecord[]) {
  let wet = 0, dirty = 0
  for (const e of list) {
    if (e.diaper === 'wet' || e.diaper === 'both') wet++
    if (e.diaper === 'dirty' || e.diaper === 'both') dirty++
  }
  return { total: list.length, wet, dirty }
}

type Props = {
  events: EventRecord[] // the selected baby's diapers of the viewed day, newest first
  past: boolean // viewing a past day: the time comes from the field
  customTime: string
  onCustomTime: (v: string) => void
  onAdd: (kind: DiaperKind) => void
  onDelete: (e: EventRecord) => void
}

// Diaper changes of the day: one tap per change, counts, and the list with delete (undo in the toast).
export function Diapers({ events, past, customTime, onCustomTime, onAdd, onDelete }: Props) {
  const { t } = useFormat()
  const c = diaperCounts(events)
  return (
    <>
      <div className="card care-summary" id="diaper-summary">
        <div className="care-big"><span id="diaper-total">{c.total}</span><small>{t('diapersN', { n: c.total })}</small></div>
        <div className="care-detail">{t('diaperDetail', { wet: c.wet, dirty: c.dirty })}</div>
      </div>
      <p className="section-label">{t('diaperAdd')}</p>
      <div className="care-buttons" id="diaper-buttons">
        {KINDS.map((k) => (
          <button key={k} id={'diaper-' + k} onClick={() => onAdd(k)}>
            <span aria-hidden="true">{ICON[k]}</span> {t('diaper_' + k)}
          </button>
        ))}
      </div>
      {past ? (
        <label className="care-time">
          <span>{t('feedTime')}</span>
          <input type="time" id="diaper-time" value={customTime} onChange={(e) => onCustomTime(e.target.value)} />
        </label>
      ) : null}
      <p className="section-label">{t('diapersOfDay')}</p>
      <ul className="feed-list" id="diaper-list">
        {events.length === 0 ? (
          <div className="empty">{t('diapersEmpty')}</div>
        ) : (
          events.map((e) => (
            <li key={e.id} className="feed-item">
              <div className="left">
                <span className="amt">{ICON[e.diaper as DiaperKind] || ''} {t('diaper_' + e.diaper)}</span>
                <span className="time">{formatTime(e.time)}</span>
              </div>
              <div className="actions">
                <button className="del" onClick={() => onDelete(e)}>{t('del')}</button>
              </div>
              {e.by ? <div className="feed-meta"><span className="feed-by">{t('addedBy', { name: String(e.by) })}</span></div> : null}
            </li>
          ))
        )}
      </ul>
    </>
  )
}
