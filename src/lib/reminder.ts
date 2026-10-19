import { todayStr } from './dates'
import type { T } from './i18n'
import type { Reminder } from './settings'

export function reminderIsDue(r: Reminder, now: Date) {
  if (!r.enabled) return false
  const parts = r.time.split(':')
  const due = new Date(now)
  due.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0)
  return now >= due
}

export function notificationsAvailable() {
  return 'Notification' in window && window.isSecureContext
}

export function showReminderNotification(t: T) {
  if (!notificationsAvailable() || Notification.permission !== 'granted') return
  const title = t('vitD')
  const opts = { body: t('notifBody'), icon: '/icon-192.png', badge: '/icon-192.png', tag: 'vitd-reminder' }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg && reg.showNotification) return reg.showNotification(title, opts)
        new Notification(title, opts)
      })
      .catch(() => {
        try { new Notification(title, opts) } catch (e) {}
      })
  } else {
    try { new Notification(title, opts) } catch (e) {}
  }
}

// Daily calendar event with an alarm: the fallback when the app is closed.
// The UID keeps the legacy "@suivi-lait" domain so re-importing does not duplicate events.
export function buildIcsUrl(time: string, t: T) {
  const parts = time.split(':')
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10)
  const hh = String(isNaN(h) ? 8 : h).padStart(2, '0')
  const mm = String(isNaN(m) ? 0 : m).padStart(2, '0')
  const start = todayStr(new Date()).replace(/-/g, '') + 'T' + hh + mm + '00'
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Milk Tracker//Rappel vitamine D//FR',
    'BEGIN:VEVENT',
    'UID:vitamine-d-' + hh + mm + '@suivi-lait',
    'DTSTAMP:' + stamp,
    'DTSTART:' + start,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:' + t('icsSummary'),
    'DESCRIPTION:' + t('icsDesc'),
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + t('vitD'),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics)
}
