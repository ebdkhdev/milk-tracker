import { useCallback, useEffect, useState } from 'react'
import { dbGetAll, dbGetAllDaily, dbGetAllDays, dbGetAllEvents, migrateFromLocalStorage } from '#/lib/db'
import type { Daily, Day, EventRecord, Feed } from '#/lib/db'

// Everything read from IndexedDB, for every baby; App derives the selected baby's day, stats and history.
// Every write ends with reload(), which bumps `rev` so the effect below reads again.
export function useData() {
  const [ready, setReady] = useState(false)
  const [rev, setRev] = useState(0)
  const [allFeeds, setAllFeeds] = useState<Feed[]>([])
  const [allDaily, setAllDaily] = useState<Daily[] | null>(null) // the first baby's per-day records
  const [allDays, setAllDays] = useState<Day[]>([]) // the other babies'
  const [allEvents, setAllEvents] = useState<EventRecord[]>([])
  const reload = useCallback(() => setRev((r) => r + 1), [])

  useEffect(() => {
    migrateFromLocalStorage().then(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    Promise.all([dbGetAll(), dbGetAllDaily(), dbGetAllDays(), dbGetAllEvents()])
      .then(([feeds, daily, days, events]) => { setAllFeeds(feeds); setAllDaily(daily); setAllDays(days); setAllEvents(events) })
      .catch((e) => console.error('Erreur de lecture', e))
  }, [ready, rev])

  return { ready, reload, allFeeds, allDaily, allDays, allEvents }
}
