import { useCallback, useEffect, useState } from 'react'
import { dbGetAll, dbGetAllDaily, dbGetByDate, dbGetDaily, migrateFromLocalStorage } from '#/lib/db'
import type { Daily, Feed } from '#/lib/db'

// Everything read from IndexedDB: the viewed day (newest bottle first) and all records for stats/history.
// Every write ends with reload(), which bumps `rev` so the effects below read again.
export function useData(dateStr: string) {
  const [ready, setReady] = useState(false)
  const [rev, setRev] = useState(0)
  const [entries, setEntries] = useState<Feed[]>([])
  const [dayRecord, setDayRecord] = useState<Daily | null>(null)
  const [allFeeds, setAllFeeds] = useState<Feed[]>([])
  const [allDaily, setAllDaily] = useState<Daily[] | null>(null)
  const reload = useCallback(() => setRev((r) => r + 1), [])

  useEffect(() => {
    migrateFromLocalStorage().then(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    dbGetByDate(dateStr)
      .then((list) => setEntries(list.sort((a, b) => +new Date(b.time) - +new Date(a.time))))
      .catch((e) => console.error('Erreur de lecture', e))
    dbGetDaily(dateStr).then(setDayRecord).catch((e) => console.error('Erreur lecture vitamine D', e))
  }, [ready, rev, dateStr])

  useEffect(() => {
    if (!ready) return
    Promise.all([dbGetAll(), dbGetAllDaily()])
      .then(([feeds, daily]) => { setAllFeeds(feeds); setAllDaily(daily) })
      .catch((e) => console.error('Erreur historique', e))
  }, [ready, rev])

  return { ready, reload, entries, dayRecord, allFeeds, allDaily }
}
