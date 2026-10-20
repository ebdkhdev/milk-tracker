import { useState } from 'react'
import { formatTime } from '#/lib/dates'
import type { EventRecord } from '#/lib/db'
import { durationText } from '#/lib/feedText'
import { useFormat } from '#/lib/format'
import { LONG_SLEEP_MIN, sleepDurationMin } from '#/lib/sleep'

type Props = {
  sleeps: EventRecord[] // the selected baby's sleeps touching the viewed day
  ongoing: EventRecord | null // the baby's sleep in progress, if any (whatever the day viewed)
  totalMin: number // slept within the viewed day
  now: Date
  onStart: () => void
  onStop: (endHHMM?: string) => string | null // now, or a corrected wake-up time; error text if refused
  onAdd: (fromHHMM: string, toHHMM: string) => string | null // error text, or null
  onDelete: (e: EventRecord) => void
}

// Sleep: start/stop (works across phones and with the app closed), the day's total and list, manual entry.
export function Sleep({ sleeps, ongoing, totalMin, now, onStart, onStop, onAdd, onDelete }: Props) {
  const { t } = useFormat()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [wake, setWake] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [wakeError, setWakeError] = useState<string | null>(null)
  const nowMs = now.getTime()
  const running = ongoing ? sleepDurationMin(ongoing, nowMs) : 0
  return (
    <>
      <div className="card care-summary" id="sleep-summary">
        {ongoing ? (
          <>
            <div className="care-big" id="sleep-running">{durationText(running, t)}</div>
            <div className="care-detail">{t('sleepingSince', { time: formatTime(ongoing.time) })}</div>
            <div className="data-row care-actions">
              <button className="data-btn primary" id="sleep-stop" onClick={() => onStop()}>☀️ {t('sleepStop')}</button>
            </div>
            {running >= LONG_SLEEP_MIN ? (
              <div className="share-confirm" id="sleep-long">
                <p>{t('sleepLong')}</p>
                <label className="care-time">
                  <span>{t('sleepWakeAt')}</span>
                  <input type="time" id="sleep-wake" value={wake} onChange={(e) => setWake(e.target.value)} />
                </label>
                <button className="data-btn" id="sleep-fix" disabled={!wake} onClick={() => setWakeError(onStop(wake))}>{t('sleepSaveWake')}</button>
                {wakeError ? <p className="settings-note share-error" id="sleep-wake-error" role="alert">{wakeError}</p> : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="care-big"><span id="sleep-total">{durationText(totalMin, t)}</span></div>
            <div className="care-detail">{t('sleepTotal')}</div>
            <div className="data-row care-actions">
              <button className="data-btn primary" id="sleep-start" onClick={onStart}>😴 {t('sleepStart')}</button>
            </div>
          </>
        )}
      </div>

      <p className="section-label">{t('sleepsOfDay')}</p>
      <ul className="feed-list" id="sleep-list">
        {sleeps.length === 0 ? (
          <div className="empty">{t('sleepsEmpty')}</div>
        ) : (
          sleeps.map((e) => (
            <li key={e.id} className="feed-item">
              <div className="left">
                <span className="amt">{formatTime(e.time)} → {e.end ? formatTime(String(e.end)) : '…'}</span>
                <span className="time">{e.end ? durationText(sleepDurationMin(e, nowMs), t) : t('sleepOngoing')}</span>
              </div>
              <div className="actions">
                <button className="del" onClick={() => onDelete(e)}>{t('del')}</button>
              </div>
              {e.by ? <div className="feed-meta"><span className="feed-by">{t('addedBy', { name: String(e.by) })}</span></div> : null}
            </li>
          ))
        )}
      </ul>

      <p className="section-label">{t('sleepAddTitle')}</p>
      <div className="card sleep-add">
        <label className="care-time"><span>{t('sleepFrom')}</span><input type="time" id="sleep-from" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="care-time"><span>{t('sleepTo')}</span><input type="time" id="sleep-to" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button
          className="data-btn"
          id="sleep-add"
          disabled={!from || !to}
          onClick={() => {
            const err = onAdd(from, to)
            setError(err)
            if (!err) { setFrom(''); setTo('') }
          }}
        >
          {t('sleepAdd')}
        </button>
        {error ? <p className="settings-note share-error" role="alert">{error}</p> : null}
      </div>
    </>
  )
}
