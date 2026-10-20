// Sleep periods are events { type: "sleep", time: start ISO, end: ISO | null }; null means "still asleep",
// so the elapsed time always comes from the start time (no timer to keep running).
import { parseDay } from './dates'
import type { EventRecord } from './db'

export const LONG_SLEEP_MIN = 12 * 60 // past this, an ongoing sleep probably had its wake-up forgotten

const startMs = (e: EventRecord) => Date.parse(e.time)
const endMs = (e: EventRecord, nowMs: number) => (e.end ? Date.parse(String(e.end)) : nowMs)

export const isSleep = (e: EventRecord) => e.type === 'sleep'
export const ongoingSleep = (events: EventRecord[]) => events.find((e) => isSleep(e) && !e.end) || null

// [start, end) of a local day
function dayBounds(dateStr: string) {
  const start = parseDay(dateStr)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.getTime(), end.getTime()]
}

// Sleeps touching that day, earliest first (a night across midnight shows on both days).
export function sleepsOn(events: EventRecord[], dateStr: string, nowMs: number) {
  const [from, to] = dayBounds(dateStr)
  return events.filter((e) => isSleep(e) && startMs(e) < to && endMs(e, nowMs) > from).sort((a, b) => startMs(a) - startMs(b))
}

// Minutes slept within that day (overlaps are clipped to the day, so midnight splits a night).
export function sleepMinutesOn(events: EventRecord[], dateStr: string, nowMs: number) {
  const [from, to] = dayBounds(dateStr)
  let ms = 0
  for (const e of sleepsOn(events, dateStr, nowMs)) ms += Math.min(endMs(e, nowMs), to) - Math.max(startMs(e), from)
  return Math.max(0, Math.round(ms / 60000))
}

export const sleepDurationMin = (e: EventRecord, nowMs: number) => Math.max(0, Math.round((endMs(e, nowMs) - startMs(e)) / 60000))
