import { parseDay } from './dates'
import type { T } from './i18n'
import { DAILY_MIN_ML } from './settings'

const BABY_KEY = 'suivi-lait-baby-v1'

// Age bands for the daily minimum. Each band applies from `fromMonths` (completed months of age)
// until the next band starts. The bands are fixed; only their millilitre values are editable.
export const TIER_STARTS = [0, 1, 2, 4, 6] as const
// Indicative defaults, meant to be adjusted by the parents (with their paediatrician).
export const DEFAULT_TIERS_ML = [500, 600, 700, 750, 700]

export type Baby = {
  birthDate: string | null // "YYYY-MM-DD"
  tiersMl: number[] // one value per TIER_STARTS entry
}

// Settings from storage, a backup or the other phone: anything unexpected falls back to the defaults.
export function sanitizeBaby(b: unknown): Baby {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const tiers = Array.isArray(o.tiersMl) ? o.tiersMl : []
  return {
    birthDate: typeof o.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.birthDate) ? o.birthDate : null,
    tiersMl: DEFAULT_TIERS_ML.map((def, i) => (Number(tiers[i]) > 0 ? Number(tiers[i]) : def)),
  }
}
export function loadBaby(): Baby {
  try { return sanitizeBaby(JSON.parse(localStorage.getItem(BABY_KEY) || 'null')) } catch (e) { return sanitizeBaby(null) }
}
export function saveBaby(b: Baby) {
  try { localStorage.setItem(BABY_KEY, JSON.stringify(b)) } catch (e) {}
}

// Completed months between the birth date and dateStr (0 before the first monthly birthday, or before birth).
export function ageInMonths(birthDate: string, dateStr: string) {
  const b = parseDay(birthDate), d = parseDay(dateStr)
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth())
  if (d.getDate() < b.getDate()) months--
  return Math.max(0, months)
}

export function ageInDays(birthDate: string, dateStr: string) {
  return Math.round((parseDay(dateStr).getTime() - parseDay(birthDate).getTime()) / 86400000)
}

export function tierIndexFor(baby: Baby, dateStr: string) {
  if (!baby.birthDate) return -1
  const months = ageInMonths(baby.birthDate, dateStr)
  let idx = 0
  TIER_STARTS.forEach((start, i) => { if (months >= start) idx = i })
  return idx
}

// The minimum for a given day: from the baby's age that day, or the fixed default without a birth date.
export function minimumFor(baby: Baby, dateStr: string) {
  const idx = tierIndexFor(baby, dateStr)
  return idx === -1 ? DAILY_MIN_ML : baby.tiersMl[idx]
}

// "2 mois", "3 semaines", "5 jours": the baby's age on dateStr, for display.
export function formatAge(t: T, birthDate: string, dateStr: string) {
  const months = ageInMonths(birthDate, dateStr)
  if (months >= 1) return t('ageMonths', { n: months })
  const days = Math.max(0, ageInDays(birthDate, dateStr))
  return days >= 7 ? t('ageWeeks', { n: Math.floor(days / 7) }) : t('ageDays', { n: days })
}
