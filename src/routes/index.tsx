import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddFeed } from '#/components/AddFeed'
import { BackupReminder } from '#/components/BackupReminder'
import { BabySettings } from '#/components/BabySettings'
import { DayNav } from '#/components/DayNav'
import { FeedList } from '#/components/FeedList'
import { Header } from '#/components/Header'
import { InstallBanner } from '#/components/InstallBanner'
import { Stats } from '#/components/Stats'
import type { DayRow } from '#/components/Stats'
import { Toast } from '#/components/Toast'
import type { ToastMsg } from '#/components/Toast'
import { TotalCard } from '#/components/TotalCard'
import { VitaminDCard } from '#/components/VitaminDCard'
import { buildBackup, parseBackup, shareOrDownload } from '#/lib/backup'
import { averageInterval, feedingRhythm } from '#/lib/rhythm'
import { loadBaby, minimumFor, saveBaby } from '#/lib/baby'
import type { Baby } from '#/lib/baby'
import { formatTime, isToday, nowHHMM, parseDay, timeOnDate, todayStr } from '#/lib/dates'
import {
  dbAdd, dbDelete, dbGetAll, dbGetAllDaily, dbGetByDate, dbGetDaily, dbImport, dbPut, dbPutDaily,
  migrateFromLocalStorage, newId,
} from '#/lib/db'
import type { Daily, Feed, MilkType } from '#/lib/db'
import { FormatProvider, useFormat } from '#/lib/format'
import { RTL_LANGS, loadLang, makeT, saveLang } from '#/lib/i18n'
import type { Lang, T, Unit } from '#/lib/i18n'
import { notificationsAvailable, reminderIsDue, showReminderNotification } from '#/lib/reminder'
import { BACKUP_SNOOZE_DAYS, backupDue, isDefaultQuick, loadBackupState, loadMilk, saveBackupState, loadQuick, loadReminder, loadUnit, saveMilk, saveQuick, saveReminder, saveUnit, suggestQuick } from '#/lib/settings'
import type { BackupState, MilkPrefs } from '#/lib/settings'
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
  const [baby, setBabyState] = useState<Baby>(loadBaby)
  const [quick, setQuickState] = useState<number[]>(loadQuick)
  const [milk, setMilkState] = useState<MilkPrefs>(loadMilk)
  const [backup, setBackupState] = useState<BackupState>(loadBackupState)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const dateStr = todayStr(viewDate)
  const viewingToday = isToday(dateStr)
  const t = useMemo(() => makeT(lang), [lang])
  // the clock is refreshed too, so "last bottle" never reads a time ahead of `now`
  const bump = () => { setRev((r) => r + 1); setNow(new Date()) }

  // One message at a time; a new one replaces the previous (and its undo).
  const showToast = (text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text, undo })
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3000)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  useEffect(() => {
    migrateFromLocalStorage().then(() => setReady(true))
    // ask the browser not to evict our data under storage pressure (best effort, no prompt on most browsers)
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW', e))
    }
  }, [])

  // before paint, so Arabic never flashes left-to-right
  useLayoutEffect(() => {
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
    showReminderNotification(t)
  }, [due, today, reminder, t])

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
      out.push({
        date: ds,
        totalMl: list.reduce((s, e) => s + e.ml, 0),
        count: list.length,
        daily: dailyByDate[ds] || null,
        minMl: minimumFor(baby, ds),
        breastMl: list.reduce((s, e) => s + (e.type === 'breast' ? e.ml : 0), 0),
        typedMl: list.reduce((s, e) => s + (e.type ? e.ml : 0), 0),
      })
    }
    return out
  }, [allFeeds, allDaily, period, now, baby])

  // average interval over the stats period (from the start of its first day to now)
  const periodInterval = useMemo(() => {
    const from = parseDay(rows[rows.length - 1].date).getTime()
    return averageInterval(allFeeds, from, now.getTime() + 60 * 1000)
  }, [allFeeds, rows, now])

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
    const feed: Feed = { id: newId(), date: dateStr, ml: Math.round(ml * 10) / 10, time }
    if (milk.track) feed.type = milk.last
    dbAdd(feed)
      .then(bump)
      .catch((e) => console.error("Erreur d'enregistrement", e))
  }

  const updateEntry = (entry: Feed, c: { ml: number; hhmm: string; type?: MilkType; note: string }) => {
    if (!c.ml || c.ml <= 0) return
    setEditingId(null)
    const next: Feed = { ...entry, ml: Math.round(c.ml * 10) / 10, time: c.hhmm ? timeOnDate(entry.date, c.hhmm) : entry.time }
    if (c.type) next.type = c.type
    const note = c.note.trim()
    if (note) next.note = note
    else delete next.note
    dbPut(next)
      .then(bump)
      .catch((e) => console.error('Erreur de modification', e))
  }

  // Deleted right away (nothing is lost if the app is closed), then restored as-is on undo.
  const removeEntry = (id: string) => {
    const entry = entries.find((e) => e.id === id)
    dbDelete(id)
      .then(() => {
        bump()
        if (entry) showToast(t('deleted'), () => { dbPut(entry).then(bump).catch((e) => console.error("Erreur d'annulation", e)) })
      })
      .catch((e) => console.error('Erreur de suppression', e))
  }

  // Built from the data already in state so share() stays inside the click (required by Safari).
  const exportData = () => {
    const text = buildBackup(allFeeds, allDaily || [], baby, quick)
    shareOrDownload(text, t('exportFile', { date: todayStr(new Date()) }))
      .then((r) => {
        if (r !== 'done') return
        setBackup({ last: new Date().toISOString(), snoozeUntil: null })
        showToast(t('exported'))
      })
      .catch((e) => console.error('Erreur export', e))
  }

  const importData = (file: File) => {
    file
      .text()
      .then((text) => {
        const parsed = parseBackup(text)
        if (!parsed) { showToast(t('importError')); return }
        return dbImport(parsed.feeds, parsed.daily).then(() => {
          // a new phone (no birth date yet) takes the file's baby settings; otherwise this phone's settings win
          if (parsed.baby && !baby.birthDate) { saveBaby(parsed.baby); setBabyState(parsed.baby) }
          if (parsed.quick && isDefaultQuick(quick)) { saveQuick(parsed.quick); setQuickState(parsed.quick) }
          bump()
          showToast(t('imported', { n: parsed.feeds.length }) + (parsed.skipped ? t('importSkipped', { n: parsed.skipped }) : ''))
        })
      })
      .catch((e) => { console.error('Erreur import', e); showToast(t('importError')) })
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

  const setMilk = (m: MilkPrefs) => { saveMilk(m); setMilkState(m) }
  const setBackup = (b: BackupState) => { saveBackupState(b); setBackupState(b) }
  const backupReminder = ready && allDaily ? backupDue(backup, allFeeds, now) : null

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
          settingsOpen={settingsOpen}
          onSettings={() => setSettingsOpen((o) => !o)}
        />
        {settingsOpen ? (
          <BabySettings
            baby={baby}
            onChange={(b) => { saveBaby(b); setBabyState(b) }}
            quick={quick}
            quickSuggestion={suggestQuick(allFeeds, now)}
            onQuick={(q) => { saveQuick(q); setQuickState(q) }}
            milk={milk}
            onMilk={setMilk}
            onClose={() => setSettingsOpen(false)}
            onExport={exportData}
            onImport={importData}
          />
        ) : null}
        {/* one banner at a time: the backup reminder (data safety) wins over the install hint */}
        {backupReminder ? (
          <BackupReminder
            days={backupReminder.days}
            onExport={exportData}
            onLater={() => setBackup({ ...backup, snoozeUntil: new Date(Date.now() + BACKUP_SNOOZE_DAYS * 24 * 3600 * 1000).toISOString() })}
          />
        ) : (
          <InstallBanner />
        )}
        <DayNav viewDate={viewDate} onGo={goToDate} />
        <TotalCard
          totalMl={entries.reduce((s, e) => s + e.ml, 0)}
          count={entries.length}
          dateStr={dateStr}
          minMl={minimumFor(baby, dateStr)}
          birthDate={baby.birthDate}
          lastFeed={viewingToday ? lastFeedText(allFeeds, now, t) : null}
          rhythm={viewingToday ? rhythmText(allFeeds, now, t) : null}
        />
        <VitaminDCard
          record={dayRecord}
          viewingToday={viewingToday}
          due={due}
          reminder={reminder}
          onToggle={toggleVitaminD}
          onReminder={setReminder}
        />
        <AddFeed past={!viewingToday} quick={quick} milk={milk} onMilkType={(type) => setMilk({ ...milk, last: type })} customTime={customTime} onCustomTime={setCustomTime} onAdd={addEntry} />
        <FeedList entries={entries} editingId={editingId} trackMilk={milk.track} onEdit={setEditingId} onSave={updateEntry} onDelete={removeEntry} />
        <Stats
          rows={rows}
          period={period}
          viewing={dateStr}
          onPeriod={setPeriod}
          avgIntervalMin={periodInterval}
          onOpen={(ds) => { goToDate(parseDay(ds)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
        />
        <Footer />
      </div>
      <Toast toast={toast} onDone={() => { clearTimeout(toastTimer.current); setToast(null) }} />
    </FormatProvider>
  )
}

// "Last bottle 2 h 40 min ago", from the latest feed of any day; hidden after 24 h.
// Feeds edited to a time in the future are ignored.
function lastFeedText(feeds: Feed[], now: Date, t: T): string | null {
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

function durationText(mins: number, t: T) {
  const h = Math.floor(mins / 60), m = mins % 60
  return h === 0 ? t('durM', { m }) : m === 0 ? t('durH', { h }) : t('durHM', { h, m })
}

// "Every 3 h 10 min on average · next around 14:30" (see lib/rhythm.ts for the rules)
function rhythmText(feeds: Feed[], now: Date, t: T): string | null {
  const r = feedingRhythm(feeds, now)
  if (!r) return null
  const vars = { d: durationText(Math.round(r.avgMin), t), time: formatTime(r.next.toISOString()) }
  return r.next.getTime() < now.getTime() ? t('rhythmLate', vars) : t('rhythm', vars)
}

function Footer() {
  const { t } = useFormat()
  return <footer>{t('footer')}</footer>
}
