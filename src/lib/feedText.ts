// Sentences about timing shown in the total card.
import { formatTime } from './dates'
import type { Feed } from './db'
import type { T } from './i18n'
import { feedingRhythm } from './rhythm'

export function durationText(mins: number, t: T) {
  const h = Math.floor(mins / 60), m = mins % 60
  return h === 0 ? t('durM', { m }) : m === 0 ? t('durH', { h }) : t('durHM', { h, m })
}

// "Last bottle 2 h 40 min ago", from the latest feed of any day; hidden after 24 h.
// Feeds edited to a time in the future are ignored.
export function lastFeedText(feeds: Feed[], now: Date, t: T): string | null {
  const nowMs = now.getTime()
  let last = -1
  for (const f of feeds) {
    const ms = Date.parse(f.time)
    if (ms <= nowMs + 60 * 1000 && ms > last) last = ms
  }
  if (last < 0) return null
  const mins = Math.max(0, Math.floor((nowMs - last) / 60000))
  if (mins >= 24 * 60) return null
  if (mins < 1) return t('lastFeedNow')
  return t('lastFeed', { d: durationText(mins, t) })
}

// "Every 3 h 10 min on average · next around 14:30" (see rhythm.ts for the rules)
export function rhythmText(feeds: Feed[], now: Date, t: T): string | null {
  const r = feedingRhythm(feeds, now)
  if (!r) return null
  const vars = { d: durationText(Math.round(r.avgMin), t), time: formatTime(r.next.toISOString()) }
  return r.next.getTime() < now.getTime() ? t('rhythmLate', vars) : t('rhythm', vars)
}
