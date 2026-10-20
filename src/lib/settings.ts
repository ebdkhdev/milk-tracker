import type { Feed, MilkType } from './db'
import { todayStr } from './dates'
import type { Unit } from './i18n'

const UNIT_KEY = 'suivi-lait-unit-v1'
const REMINDER_KEY = 'suivi-lait-reminder-v1'
const QUICK_KEY = 'suivi-lait-quick-v1'
const MILK_KEY = 'suivi-lait-milk-v1'
const BACKUP_KEY = 'suivi-lait-backup-v1'
const DEVICE_KEY = 'suivi-lait-device-v1'

export const ML_PER_OZ = 29.5735
export const DAILY_MIN_ML = 600 // minimum quantité de lait par jour
export const QUICK_AMOUNTS_ML = [60, 90, 120, 150] // defaults; the user can change them in ⚙
export const MAX_FEED_ML = 1000

export type Reminder = { enabled: boolean; time: string; lastNotified: string | null }

export function loadUnit(): Unit {
  try {
    return localStorage.getItem(UNIT_KEY) === 'oz' ? 'oz' : 'ml'
  } catch (e) {
    return 'ml'
  }
}
export function saveUnit(u: Unit) {
  try { localStorage.setItem(UNIT_KEY, u) } catch (e) {}
}

export function loadReminder(): Reminder {
  try {
    const r = JSON.parse(localStorage.getItem(REMINDER_KEY) || 'null')
    if (r && typeof r === 'object') return { enabled: !!r.enabled, time: r.time || '08:00', lastNotified: r.lastNotified || null }
  } catch (e) {}
  return { enabled: false, time: '08:00', lastNotified: null }
}
export function saveReminder(r: Reminder) {
  try { localStorage.setItem(REMINDER_KEY, JSON.stringify(r)) } catch (e) {}
}

// Quick-add amounts (ml), always four.
export function sanitizeQuick(q: unknown): number[] {
  const arr = Array.isArray(q) ? q : []
  return QUICK_AMOUNTS_ML.map((def, i) => {
    const v = Number(arr[i])
    return v > 0 && v <= MAX_FEED_ML ? Math.round(v) : def
  })
}
export function loadQuick(): number[] {
  try { return sanitizeQuick(JSON.parse(localStorage.getItem(QUICK_KEY) || 'null')) } catch (e) { return QUICK_AMOUNTS_ML.slice() }
}
export function saveQuick(q: number[]) {
  try { localStorage.setItem(QUICK_KEY, JSON.stringify(q)) } catch (e) {}
}
export const isDefaultQuick = (q: number[]) => q.every((v, i) => v === QUICK_AMOUNTS_ML[i])

// The four most frequent amounts of the last 14 days, ascending; null with fewer than four distinct amounts.
export function suggestQuick(feeds: Feed[], now: Date): number[] | null {
  const from = new Date(now)
  from.setDate(from.getDate() - 13)
  const since = todayStr(from)
  const counts = new Map<number, number>()
  for (const f of feeds) {
    if (f.date < since) continue
    const ml = Math.round(f.ml)
    counts.set(ml, (counts.get(ml) || 0) + 1)
  }
  if (counts.size < 4) return null
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4).map((e) => e[0]).sort((a, b) => a - b)
}

// Milk type tracking is opt-in; `last` is the type preselected for the next bottle.
export type MilkPrefs = { track: boolean; last: MilkType }
export const NOTE_MAX = 120
export function loadMilk(): MilkPrefs {
  try {
    const m = JSON.parse(localStorage.getItem(MILK_KEY) || 'null')
    if (m && typeof m === 'object') return { track: !!m.track, last: m.last === 'breast' ? 'breast' : 'formula' }
  } catch (e) {}
  return { track: false, last: 'formula' }
}
export function saveMilk(m: MilkPrefs) {
  try { localStorage.setItem(MILK_KEY, JSON.stringify(m)) } catch (e) {}
}

// Backup reminder: date of the last successful export, and a snooze ("Plus tard").
export type BackupState = { last: string | null; snoozeUntil: string | null }
export const BACKUP_EVERY_DAYS = 30
export const BACKUP_FIRST_DAYS = 14 // without any export, remind once the oldest bottle is this old
export const BACKUP_SNOOZE_DAYS = 7
export function loadBackupState(): BackupState {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null')
    if (b && typeof b === 'object') return { last: typeof b.last === 'string' ? b.last : null, snoozeUntil: typeof b.snoozeUntil === 'string' ? b.snoozeUntil : null }
  } catch (e) {}
  return { last: null, snoozeUntil: null }
}
export function saveBackupState(b: BackupState) {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(b)) } catch (e) {}
}
const DAY_MS = 24 * 3600 * 1000
// null when no reminder is due; otherwise the days since the last export (0 = never exported)
export function backupDue(b: BackupState, feeds: Feed[], now: Date): { days: number } | null {
  if (feeds.length === 0) return null
  if (b.snoozeUntil && Date.parse(b.snoozeUntil) > now.getTime()) return null
  if (b.last) {
    const days = Math.floor((now.getTime() - Date.parse(b.last)) / DAY_MS)
    return days >= BACKUP_EVERY_DAYS ? { days } : null
  }
  const oldest = feeds.reduce((min, f) => (f.date < min ? f.date : min), feeds[0].date)
  const [y, m, d] = oldest.split('-').map(Number)
  return now.getTime() - new Date(y, m - 1, d).getTime() >= BACKUP_FIRST_DAYS * DAY_MS ? { days: 0 } : null
}

// This parent's name, stamped on the bottles they add so the other parent sees who gave what.
export const NAME_MAX = 20
export function loadDeviceName(): string {
  try { return (localStorage.getItem(DEVICE_KEY) || '').slice(0, NAME_MAX) } catch (e) { return '' }
}
export function saveDeviceName(name: string) {
  try {
    if (name) localStorage.setItem(DEVICE_KEY, name)
    else localStorage.removeItem(DEVICE_KEY)
  } catch (e) {}
}
