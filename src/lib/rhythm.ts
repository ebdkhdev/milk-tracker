// Feeding rhythm: average time between bottles and the expected next one.
import type { Feed } from './db'

export const GAP_MAX_MIN = 8 * 60 // longer gaps are taken as unlogged bottles and left out of the average
export const GAP_MIN_MIN = 10 // closer bottles are one feed in two goes (a top-up), not an interval
export const MIN_INTERVALS = 3 // fewer usable intervals: no average

// Average interval in minutes between consecutive bottles taken in [fromMs, toMs], or null without enough data.
export function averageInterval(feeds: Feed[], fromMs: number, toMs: number): number | null {
  const times = feeds.map((f) => Date.parse(f.time)).filter((ms) => ms >= fromMs && ms <= toMs).sort((a, b) => a - b)
  let sum = 0, n = 0
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 60000
    if (gap < GAP_MIN_MIN || gap > GAP_MAX_MIN) continue
    sum += gap
    n++
  }
  return n >= MIN_INTERVALS ? sum / n : null
}

// Uses the last 24 h, or the last 7 days when the day has too few bottles. Hidden 24 h after the last bottle,
// like "last bottle"; feeds in the future (after an edit) are ignored.
export function feedingRhythm(feeds: Feed[], now: Date): { avgMin: number; next: Date } | null {
  const nowMs = now.getTime() + 60 * 1000
  let last = -1
  for (const f of feeds) { const ms = Date.parse(f.time); if (ms <= nowMs && ms > last) last = ms }
  if (last < 0 || now.getTime() - last >= 24 * 3600 * 1000) return null
  const avg = averageInterval(feeds, nowMs - 24 * 3600 * 1000, nowMs) ?? averageInterval(feeds, nowMs - 7 * 24 * 3600 * 1000, nowMs)
  if (avg === null) return null
  return { avgMin: avg, next: new Date(last + avg * 60000) }
}
