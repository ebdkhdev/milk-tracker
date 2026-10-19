import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AddFeed } from '#/components/AddFeed'
import { DayNav } from '#/components/DayNav'
import { FeedList } from '#/components/FeedList'
import { Header } from '#/components/Header'
import { InstallBanner } from '#/components/InstallBanner'
import { Stats } from '#/components/Stats'
import type { DayRow } from '#/components/Stats'
import { TotalCard } from '#/components/TotalCard'
import { VitaminDCard } from '#/components/VitaminDCard'
import { isToday, nowHHMM, parseDay, timeOnDate, todayStr } from '#/lib/dates'
import {
  dbAdd, dbDelete, dbGetAll, dbGetAllDaily, dbGetByDate, dbGetDaily, dbPut, dbPutDaily,
  migrateFromLocalStorage, newId,
} from '#/lib/db'
import type { Daily, Feed } from '#/lib/db'
import { FormatProvider, useFormat } from '#/lib/format'
import { RTL_LANGS, loadLang, makeT, saveLang } from '#/lib/i18n'
import type { Lang, Unit } from '#/lib/i18n'
import { notificationsAvailable, reminderIsDue, showReminderNotification } from '#/lib/reminder'
import { loadReminder, loadUnit, saveReminder, saveUnit } from '#/lib/settings'
import type { Reminder } from '#/lib/settings'

// Everything depends on browser storage and the local clock: render on the client only.
// The prerendered shell holds an empty Suspense boundary for this route; wrapInSuspense + ClientOnly
// make the first client render match it (empty), so hydration succeeds before the app mounts.
export const Route = createFileRoute('/')({
  ssr: false,
  wrapInSuspense: true,
  component: () => (
    <ClientOnly>
      <App />
    </ClientOnly>
  ),
})

function App() {
  const [lang, setLang] = useState<Lang>(loadLang)
  const [unit, setUnit] = useState<Unit>(loadUnit)
  const [reminder, setReminderState] = useState<Reminder>(loadReminder)
  const [viewDate, setViewDate] = useState(() => new Date())
  const [customTime, setCustomTime] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30>(7)
  const [now, setNow] = useState(() => new Date())
  // bumped after every write so the effects below reload from IndexedDB
  const [rev, setRev] = useState(0)
  const [ready, setReady] = useState(false)
  const [entries, setEntries] = useState<Feed[]>([])
  const [dayRecord, setDayRecord] = useState<Daily | null>(null)
  const [allFeeds, setAllFeeds] = useState<Feed[]>([])
  const [allDaily, setAllDaily] = useState<Daily[] | null>(null)

  const dateStr = todayStr(viewDate)
  const viewingToday = isToday(dateStr)
  const bump = () => setRev((r) => r + 1)

  useEffect(() => {
    migrateFromLocalStorage().then(() => setReady(true))
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW', e))
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr'
  }, [lang])

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

  // Clock for the reminder: every minute and whenever the app comes back to the foreground.
  useEffect(() => {
    const tick = () => setNow(new Date())
    const onVisible = () => { if (!document.hidden) tick() }
    const id = setInterval(tick, 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const today = todayStr(now)
  const todayGiven = allDaily ? !!allDaily.find((r) => r.date === today && r.vitaminD) : null
  const due = reminderIsDue(reminder, now) && todayGiven === false

  // At most one notification per day, only while the app is open.
  useEffect(() => {
    if (!due || reminder.lastNotified === today) return
    const next = { ...reminder, lastNotified: today }
    saveReminder(next)
    setReminderState(next)
    showReminderNotification(makeT(lang))
  }, [due, today, reminder, lang])

  const rows = useMemo<DayRow[]>(() => {
    const byDate: Record<string, Feed[]> = {}
    allFeeds.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e) })
    const dailyByDate: Record<string, Daily> = {}
    ;(allDaily || []).forEach((r) => { dailyByDate[r.date] = r })
    const out: DayRow[] = []
    for (let i = 0; i < period; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const ds = todayStr(d)
      const list = byDate[ds] || []
      out.push({ date: ds, totalMl: list.reduce((s, e) => s + e.ml, 0), count: list.length, daily: dailyByDate[ds] || null })
    }
    return out
  }, [allFeeds, allDaily, period, now])

  // Always change the viewed day through here: clamps to today, leaves edit mode, pre-fills the past-day time.
  const goToDate = useCallback((d: Date) => {
    const t = new Date()
    if (d > t) d = t
    setViewDate(d)
    setEditingId(null)
    setCustomTime(isToday(todayStr(d)) ? '' : nowHHMM())
  }, [])

  const addEntry = (ml: number) => {
    if (!ml || ml <= 0) return
    const time = viewingToday ? new Date().toISOString() : timeOnDate(dateStr, customTime || '12:00')
    dbAdd({ id: newId(), date: dateStr, ml: Math.round(ml * 10) / 10, time })
      .then(bump)
      .catch((e) => console.error("Erreur d'enregistrement", e))
  }

  const updateEntry = (entry: Feed, ml: number, hhmm: string) => {
    if (!ml || ml <= 0) return
    setEditingId(null)
    dbPut({ ...entry, ml: Math.round(ml * 10) / 10, time: hhmm ? timeOnDate(entry.date, hhmm) : entry.time })
      .then(bump)
      .catch((e) => console.error('Erreur de modification', e))
  }

  const removeEntry = (id: string) => {
    dbDelete(id).then(bump).catch((e) => console.error('Erreur de suppression', e))
  }

  const toggleVitaminD = () => {
    dbGetDaily(dateStr)
      .then((rec) => {
        const given = !(rec && rec.vitaminD)
        return dbPutDaily({ date: dateStr, vitaminD: given, vitaminDTime: given ? new Date().toISOString() : null })
      })
      .then(bump)
      .catch((e) => console.error('Erreur vitamine D', e))
  }

  const setReminder = (enabled: boolean, time: string | null) => {
    const next = { ...reminder, enabled, time: time || reminder.time }
    saveReminder(next)
    setReminderState(next)
    if (enabled && notificationsAvailable() && Notification.permission === 'default') {
      Notification.requestPermission().then(() => setReminderState((r) => ({ ...r })))
    }
  }

  return (
    <FormatProvider lang={lang} unit={unit}>
      <div className="wrap">
        <Header
          onLang={(l) => { saveLang(l); setLang(l) }}
          onUnit={(u) => { saveUnit(u); setUnit(u) }}
        />
        <InstallBanner />
        <DayNav viewDate={viewDate} onGo={goToDate} />
        <TotalCard totalMl={entries.reduce((s, e) => s + e.ml, 0)} count={entries.length} />
        <VitaminDCard
          record={dayRecord}
          viewingToday={viewingToday}
          due={due}
          reminder={reminder}
          onToggle={toggleVitaminD}
          onReminder={setReminder}
        />
        <AddFeed past={!viewingToday} customTime={customTime} onCustomTime={setCustomTime} onAdd={addEntry} />
        <FeedList entries={entries} editingId={editingId} onEdit={setEditingId} onSave={updateEntry} onDelete={removeEntry} />
        <Stats
          rows={rows}
          period={period}
          viewing={dateStr}
          onPeriod={setPeriod}
          onOpen={(ds) => { goToDate(parseDay(ds)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
        />
        <Footer />
      </div>
    </FormatProvider>
  )
}

function Footer() {
  const { t } = useFormat()
  return <footer>{t('footer')}</footer>
}
