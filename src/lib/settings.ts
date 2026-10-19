import type { Unit } from './i18n'

const UNIT_KEY = 'suivi-lait-unit-v1'
const REMINDER_KEY = 'suivi-lait-reminder-v1'

export const ML_PER_OZ = 29.5735
export const DAILY_MIN_ML = 600 // minimum quantité de lait par jour
export const QUICK_AMOUNTS_ML = [60, 90, 120, 150]

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
