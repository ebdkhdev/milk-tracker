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

function hhmm(time: string) {
  const parts = time.split(':')
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10)
  return [String(isNaN(h) ? 8 : h).padStart(2, '0'), String(isNaN(m) ? 0 : m).padStart(2, '0')]
}

// Daily event as a Google Calendar template link (opens in the browser, no file): the fallback when the app is closed.
// Dates without "Z" are read in the ctz time zone; the alert is the calendar's default one.
export function buildGoogleCalendarUrl(time: string, t: T) {
  const [hh, mm] = hhmm(time)
  const day = todayStr(new Date()).replace(/-/g, '')
  const end = new Date(2000, 0, 1, parseInt(hh, 10), parseInt(mm, 10) + 5)
  const endHm = String(end.getHours()).padStart(2, '0') + String(end.getMinutes()).padStart(2, '0')
  // An end past midnight would need the next day; keep the event within the start day instead.
  const dates = day + 'T' + hh + mm + '00/' + day + 'T' + (endHm > hh + mm ? endHm : '2359') + '00'
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: t('eventSummary'),
    details: t('eventDesc'),
    dates,
    recur: 'RRULE:FREQ=DAILY',
  })
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (tz) params.set('ctz', tz)
  return 'https://calendar.google.com/calendar/render?' + params.toString()
}
