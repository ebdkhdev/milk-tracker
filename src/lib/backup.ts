// Export / import of all data as a JSON file. Import merges: records are matched by id (feeds) or date (daily).
import { DEFAULT_TIERS_ML } from './baby'
import type { Baby, Profile } from './baby'
import { sanitizeProfile } from './baby'
import type { Daily, Day, EventRecord, Feed } from './db'
import { newId } from './db'
import { NAME_MAX, NOTE_MAX, sanitizeQuick } from './settings'

const APP = 'milk-tracker'
const VERSION = 1
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[\w.-]{1,64}$/

// days / events / profiles: other babies' vitamin D, diapers-sleep-growth, babies' names (v2.9+; absent in older files)
export type Backup = { app: string; version: number; exportedAt: string; feeds: Feed[]; daily: Daily[]; baby: Baby; quick: number[]; days: Day[]; events: EventRecord[]; profiles: Profile[] }
export type Parsed = { feeds: Feed[]; daily: Daily[]; baby: Baby | null; quick: number[] | null; days: Day[]; events: EventRecord[]; profiles: Profile[]; skipped: number }

export function buildBackup(feeds: Feed[], daily: Daily[], baby: Baby, quick: number[], extra: { days: Day[]; events: EventRecord[]; profiles: Profile[] }): string {
  const data: Backup = { app: APP, version: VERSION, exportedAt: new Date().toISOString(), feeds, daily, baby, quick, ...extra }
  return JSON.stringify(data, null, 2)
}

const validTime = (v: unknown) => typeof v === 'string' && !isNaN(Date.parse(v))

// Returns null when the file is not a Milk Tracker backup; invalid rows are skipped and counted.
export function parseBackup(text: string): Parsed | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!data || data.app !== APP || !Array.isArray(data.feeds)) return null
  let skipped = 0
  const feeds: Feed[] = []
  for (const f of data.feeds as Array<Record<string, unknown>>) {
    const ml = Number(f && f.ml)
    if (f && typeof f.date === 'string' && DAY_RE.test(f.date) && ml > 0 && ml < 10000 && validTime(f.time)) {
      const feed: Feed = { id: typeof f.id === 'string' && f.id ? f.id : newId(), date: f.date, ml, time: f.time as string }
      if (f.type === 'formula' || f.type === 'breast') feed.type = f.type
      if (typeof f.note === 'string' && f.note.trim()) feed.note = f.note.trim().slice(0, NOTE_MAX)
      if (typeof f.by === 'string' && f.by.trim()) feed.by = f.by.trim().slice(0, NAME_MAX)
      if (typeof f.babyId === 'string' && ID_RE.test(f.babyId) && f.babyId !== 'b1') feed.babyId = f.babyId
      if (Number(f.updatedAt) > 0) feed.updatedAt = Number(f.updatedAt)
      feeds.push(feed)
    } else skipped++
  }
  const daily: Daily[] = []
  for (const d of Array.isArray(data.daily) ? (data.daily as Array<Record<string, unknown>>) : []) {
    if (d && typeof d.date === 'string' && DAY_RE.test(d.date)) {
      daily.push({
        date: d.date,
        vitaminD: !!d.vitaminD,
        vitaminDTime: validTime(d.vitaminDTime) ? (d.vitaminDTime as string) : null,
        ...(Number(d.updatedAt) > 0 ? { updatedAt: Number(d.updatedAt) } : {}),
      })
    } else skipped++
  }
  let baby: Baby | null = null
  const b = data.baby as Record<string, unknown> | undefined
  if (b && typeof b === 'object') {
    const tiers = Array.isArray(b.tiersMl) ? b.tiersMl : []
    baby = {
      birthDate: typeof b.birthDate === 'string' && DAY_RE.test(b.birthDate) ? b.birthDate : null,
      tiersMl: DEFAULT_TIERS_ML.map((def, i) => (Number(tiers[i]) > 0 ? Number(tiers[i]) : def)),
    }
  }
  const quick = Array.isArray(data.quick) ? sanitizeQuick(data.quick) : null
  const days: Day[] = []
  for (const d of Array.isArray(data.days) ? (data.days as Array<Record<string, unknown>>) : []) {
    if (d && typeof d.babyId === 'string' && ID_RE.test(d.babyId) && typeof d.date === 'string' && DAY_RE.test(d.date)) {
      days.push({ id: d.babyId + '|' + d.date, babyId: d.babyId, date: d.date, vitaminD: !!d.vitaminD, vitaminDTime: validTime(d.vitaminDTime) ? (d.vitaminDTime as string) : null, ...(Number(d.updatedAt) > 0 ? { updatedAt: Number(d.updatedAt) } : {}) })
    } else skipped++
  }
  const events: EventRecord[] = []
  for (const e of Array.isArray(data.events) ? (data.events as Array<Record<string, unknown>>) : []) {
    if (e && typeof e.id === 'string' && ID_RE.test(e.id) && typeof e.type === 'string' && typeof e.date === 'string' && DAY_RE.test(e.date) && validTime(e.time) && JSON.stringify(e).length < 2000) {
      events.push(e as EventRecord)
    } else skipped++
  }
  const profiles: Profile[] = (Array.isArray(data.profiles) ? (data.profiles as Array<Record<string, unknown>>) : [])
    .filter((p) => p && typeof p.id === 'string' && ID_RE.test(p.id))
    .map((p) => sanitizeProfile(p, p.id as string))
  return { feeds, daily, baby, quick, days, events, profiles, skipped }
}

// On phones, the share sheet lets people save the file to iCloud Drive / Files or send it by mail.
// Must be called synchronously from the click: Safari refuses share() after an await.
export function shareOrDownload(text: string, filename: string): Promise<'done' | 'cancelled'> {
  const file = new File([text], filename, { type: 'application/json' })
  const download = () => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return 'done' as const
  }
  const touch = navigator.maxTouchPoints > 0
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file] }).then(
      () => 'done' as const,
      (e) => (e && e.name === 'AbortError' ? ('cancelled' as const) : download()),
    )
  }
  return Promise.resolve(download())
}
