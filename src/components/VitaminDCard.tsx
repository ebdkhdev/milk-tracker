import { formatTime } from '#/lib/dates'
import type { Daily } from '#/lib/db'
import { useFormat } from '#/lib/format'
import { buildGoogleCalendarUrl, buildIcsUrl, notificationsAvailable } from '#/lib/reminder'
import type { Reminder } from '#/lib/settings'

type Props = {
  record: Daily | null
  viewingToday: boolean
  due: boolean
  reminder: Reminder
  onToggle: () => void
  onReminder: (enabled: boolean, time: string | null) => void
}

export function VitaminDCard({ record, viewingToday, due, reminder, onToggle, onReminder }: Props) {
  const { t } = useFormat()
  const given = !!(record && record.vitaminD)
  const showDue = viewingToday && due

  let sub: string
  if (showDue) sub = t('reminderDue')
  else if (given) sub = record?.vitaminDTime ? t('vitdGivenAt', { time: formatTime(record.vitaminDTime) }) : t('vitdGiven')
  else sub = viewingToday ? t('vitdNotYetToday') : t('vitdNotGiven')

  let note = ''
  if (reminder.enabled) {
    if (!notificationsAvailable()) note = t('noteUnsupported')
    else if (Notification.permission === 'denied') note = t('noteDenied')
    else note = t('noteOk')
  }

  const cls = 'vitd-card' + (given ? ' done' : '') + (showDue ? ' due' : '')
  return (
    <>
      <div className={cls} id="vitd-card">
        <div className="vitd-row">
          <div className="vitd-text">
            <span className="vitd-title" id="vitd-title">{t('vitD')}</span>
            <span className="vitd-sub" id="vitd-sub">{sub}</span>
          </div>
          <button id="vitd-btn" aria-pressed={given} onClick={onToggle}>
            {given ? t('vitdBtnDone') : t('vitdBtnGive')}
          </button>
        </div>
        <div className="reminder-row">
          <label>
            <input
              type="checkbox"
              className="switch"
              role="switch"
              id="reminder-enabled"
              checked={reminder.enabled}
              onChange={(e) => onReminder(e.target.checked, null)}
            />{' '}
            <span>{t('reminderDaily')}</span>
          </label>
          <div className="reminder-right">
            <input
              type="time"
              id="reminder-time"
              aria-label={t('reminderTime')}
              value={reminder.time}
              onChange={(e) => onReminder(reminder.enabled, e.target.value || '08:00')}
            />
            <a href={buildIcsUrl(reminder.time, t)} id="reminder-ics" download={t('icsFile')}>
              {t('calendar')}
            </a>
            <a href={buildGoogleCalendarUrl(reminder.time, t)} id="reminder-gcal" target="_blank" rel="noopener noreferrer">
              {t('googleCalendar')}
            </a>
          </div>
        </div>
      </div>
      <div className={'reminder-note' + (note ? ' show' : '')} id="reminder-note">{note}</div>
      {note ? null : <div className="vitd-spacer" />}
    </>
  )
}
