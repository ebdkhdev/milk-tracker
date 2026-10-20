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

// ---- Several babies ----
// The first baby ("b1") keeps everything it had before: its settings above (kind "baby" when shared) and its
// records without a babyId. Names and sex, for every baby, and the other babies' settings live in profiles
// (kind "profile"), which older versions of the app never read or write.
export const FIRST_BABY = 'b1'
const PROFILES_KEY = 'suivi-lait-babies-v1'
const CURRENT_KEY = 'suivi-lait-current-baby-v1'

export type Sex = 'f' | 'm' | null
// updatedAt: last change (ms), so an older copy from the other phone never overwrites a newer one
export type Profile = { id: string; name: string; sex: Sex; birthDate: string | null; tiersMl: number[]; updatedAt?: number }
export type BabyInfo = Baby & { id: string; name: string; sex: Sex }

export const NAME_MAX_BABY = 20
const ID_RE = /^[\w.-]{1,64}$/
export const babyOf = (r: { babyId?: string }) => r.babyId || FIRST_BABY

export function sanitizeProfile(p: unknown, id: string): Profile {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  const b = sanitizeBaby(o)
  return {
    id,
    name: typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX_BABY) : '',
    sex: o.sex === 'f' || o.sex === 'm' ? o.sex : null,
    birthDate: b.birthDate,
    tiersMl: b.tiersMl,
    ...(Number(o.updatedAt) > 0 ? { updatedAt: Number(o.updatedAt) } : {}),
  }
}

// Always contains the first baby's profile (name and sex only matter for it).
export function loadProfiles(): Profile[] {
  let list: Profile[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]')
    if (Array.isArray(raw)) list = raw.filter((p) => p && typeof p.id === 'string' && ID_RE.test(p.id)).map((p) => sanitizeProfile(p, p.id))
  } catch (e) {}
  if (!list.some((p) => p.id === FIRST_BABY)) list.unshift(sanitizeProfile(null, FIRST_BABY))
  return list
}
export function saveProfiles(list: Profile[]) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)) } catch (e) {}
}

// Every baby with its settings: the first one from its own settings, the others from their profile.
export function babyList(first: Baby, profiles: Profile[]): BabyInfo[] {
  return profiles.map((p) => (p.id === FIRST_BABY ? { ...first, id: p.id, name: p.name, sex: p.sex } : { ...p }))
}

export function loadCurrentBaby(): string {
  try { return localStorage.getItem(CURRENT_KEY) || FIRST_BABY } catch (e) { return FIRST_BABY }
}
export function saveCurrentBaby(id: string) {
  try { localStorage.setItem(CURRENT_KEY, id) } catch (e) {}
}
export const newBabyId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
