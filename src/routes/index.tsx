import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddFeed } from '#/components/AddFeed'
import { BackupReminder } from '#/components/BackupReminder'
import { BabySettings } from '#/components/BabySettings'
import { DayNav } from '#/components/DayNav'
import { FeedList } from '#/components/FeedList'
import { Header } from '#/components/Header'
import { InstallBanner } from '#/components/InstallBanner'
import { NotificationSettings } from '#/components/NotificationSettings'
import { Report } from '#/components/Report'
import { ShareSettings } from '#/components/ShareSettings'
import { Stats, buildRows } from '#/components/Stats'
import { Toast } from '#/components/Toast'
import { TotalCard } from '#/components/TotalCard'
import { VitaminDCard } from '#/components/VitaminDCard'
import { useClock } from '#/hooks/useClock'
import { useData } from '#/hooks/useData'
import { useSharing } from '#/hooks/useSharing'
import { useToast } from '#/hooks/useToast'
import { buildBackup, parseBackup, shareOrDownload } from '#/lib/backup'
import { loadBaby, minimumFor, saveBaby } from '#/lib/baby'
import type { Baby } from '#/lib/baby'
import { isToday, nowHHMM, parseDay, timeOnDate, todayStr } from '#/lib/dates'
import { dbAdd, dbDelete, dbGetDaily, dbImport, dbPut, dbPutDaily, dbQueue, newId } from '#/lib/db'
import type { Feed, MilkType } from '#/lib/db'
import { lastFeedText, rhythmText } from '#/lib/feedText'
import { FormatProvider, useFormat } from '#/lib/format'
import { RTL_LANGS, loadLang, makeT, saveLang } from '#/lib/i18n'
import type { Lang, Unit } from '#/lib/i18n'
import { notificationsAvailable, reminderIsDue, showReminderNotification } from '#/lib/reminder'
import { disablePush, enablePush, loadPush, refreshPush, savePush, updatePush } from '#/lib/push'
import type { PushDevice, PushState } from '#/lib/push'
import { averageInterval, feedingRhythm } from '#/lib/rhythm'
import {
  BACKUP_SNOOZE_DAYS, backupDue, isDefaultQuick, loadBackupState, loadDeviceName, loadMilk, loadQuick, loadReminder,
  loadUnit, saveBackupState, saveDeviceName, saveMilk, saveQuick, saveReminder, saveUnit, suggestQuick,
} from '#/lib/settings'
import type { BackupState, MilkPrefs, Reminder } from '#/lib/settings'

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
  const [deviceName, setDeviceName] = useState(loadDeviceName)
  const [push, setPushState] = useState<PushState>(loadPush)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const reportClosed = useRef(false)
  const [viewDate, setViewDate] = useState(() => new Date())
  const [customTime, setCustomTime] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30>(7)

  const dateStr = todayStr(viewDate)
  const viewingToday = isToday(dateStr)
  const t = useMemo(() => makeT(lang), [lang])
  const { now, refresh: refreshClock } = useClock()
  const { ready, reload, entries, dayRecord, allFeeds, allDaily } = useData(dateStr)
  const { toast, showToast, closeToast } = useToast()
  // after every local write: read the data again, and refresh the clock so "last bottle" is never ahead
  const bump = () => { reload(); refreshClock() }

  const saveBabyLocally = (b: Baby) => { saveBaby(b); setBabyState(b) }
  const sharing = useSharing({
    ready,
    t,
    showToast,
    onRemoteData: reload,
    onRemoteBaby: saveBabyLocally,
    shareBaby: (updatedAt) => queueBaby(baby, updatedAt),
    hasBirthDate: !!baby.birthDate,
  })
  // baby settings are shared with the family (quick amounts, milk type preference and reminder stay per phone)
  const setBaby = (b: Baby) => { saveBabyLocally(b); queueBaby(b, Date.now()) }

  useEffect(() => {
    // ask the browser not to evict our data under storage pressure (best effort, no prompt on most browsers)
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW', e))
    }
  }, [])

  // back from the report: return focus to the button that opened it
  useEffect(() => {
    if (reportOpen || !reportClosed.current) return
    reportClosed.current = false
    const btn = document.getElementById('report-btn')
    if (btn) { btn.scrollIntoView({ block: 'center' }); btn.focus() }
  }, [reportOpen])

  // before paint, so Arabic never flashes left-to-right
  useLayoutEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr'
  }, [lang])

  const today = todayStr(now)
  const todayGiven = allDaily ? !!allDaily.find((r) => r.date === today && r.vitaminD) : null
  const due = reminderIsDue(reminder, now) && todayGiven === false

  // At most one notification per day, only while the app is open (and not when push already covers it).
  useEffect(() => {
    if (!due || reminder.lastNotified === today) return
    const next = { ...reminder, lastNotified: today }
    saveReminder(next)
    setReminderState(next)
    if (!push.enabled) showReminderNotification(t)
  }, [due, today, reminder, t, push.enabled])

  // Push: what the server needs to schedule this phone's notifications. Sent on start (with the
  // subscription, which iOS may have replaced) and whenever something it depends on changes.
  const rhythm = useMemo(() => feedingRhythm(allFeeds, now), [allFeeds, now])
  const lastFeedAt = useMemo(() => allFeeds.reduce((m, f) => Math.max(m, Date.parse(f.time) <= now.getTime() + 60e3 ? Date.parse(f.time) : 0), 0), [allFeeds, now])
  const pushDevice: PushDevice = {
    lang, unit, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, name: deviceName,
    prefs: { vitd: reminder.enabled, vitdTime: reminder.time, nextFeed: push.nextFeed, partner: push.partner },
    vitdGivenDate: todayGiven ? today : null,
    ...(rhythm && lastFeedAt ? { lastFeedAt, nextFeedAt: rhythm.next.getTime() } : {}),
  }
  const pushKey = JSON.stringify([pushDevice, sharing.code])
  const pushStarted = useRef(false)
  useEffect(() => {
    if (!ready || !allDaily || !push.enabled) return
    const first = !pushStarted.current
    pushStarted.current = true
    const id = setTimeout(() => (first ? refreshPush(push, pushDevice) : updatePush(push, pushDevice)), first ? 0 : 2000)
    return () => clearTimeout(id)
    // pushKey covers every field of pushDevice and the family membership
  }, [ready, allDaily, pushKey, push.enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  const setPush = (p: PushState) => { savePush(p); setPushState(p) }

  const rows = useMemo(() => buildRows(allFeeds, allDaily || [], period, now, baby), [allFeeds, allDaily, period, now, baby])

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
    if (deviceName && sharing.code) feed.by = deviceName
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
          if (parsed.baby && !baby.birthDate) setBaby(parsed.baby)
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
        {reportOpen ? (
          <Report
            rows={rows}
            feeds={allFeeds}
            baby={baby}
            period={period}
            avgIntervalMin={periodInterval}
            onPeriod={setPeriod}
            onClose={() => { reportClosed.current = true; setReportOpen(false) }}
            onShared={() => showToast(t('copied'))}
          />
        ) : <>
        {settingsOpen ? (
          <BabySettings
            baby={baby}
            onChange={setBaby}
            quick={quick}
            quickSuggestion={suggestQuick(allFeeds, now)}
            onQuick={(q) => { saveQuick(q); setQuickState(q) }}
            milk={milk}
            onMilk={setMilk}
            onClose={() => setSettingsOpen(false)}
            onExport={exportData}
            onImport={importData}
            shared={!!sharing.code}
            notifications={
              <NotificationSettings
                push={push}
                shared={!!sharing.code}
                reminderOn={reminder.enabled}
                reminderTime={reminder.time}
                onEnable={() => enablePush(push, pushDevice).then((r) => { if (r === 'ok') { setPushState(loadPush()); showToast(t('notifOn')) } return r })}
                onDisable={() => { disablePush(push).then(() => setPushState(loadPush())) }}
                onChange={setPush}
              />
            }
            share={
              <ShareSettings
                code={sharing.code}
                status={sharing.status}
                lastSync={sharing.lastSync}
                name={deviceName}
                onName={(n) => { saveDeviceName(n); setDeviceName(n) }}
                onCreate={sharing.create}
                onJoin={sharing.join}
                onSendCode={sharing.sendCode}
                onSyncNow={sharing.runSync}
                onLeave={sharing.leave}
                onDelete={sharing.erase}
              />
            }
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
          onReport={() => { setSettingsOpen(false); setReportOpen(true) }}
        />
        <Footer shared={!!sharing.code} />
        </>}
      </div>
      <Toast toast={toast} onDone={closeToast} />
    </FormatProvider>
  )
}

// the baby settings change sent to the family (a no-op when this phone isn't sharing)
function queueBaby(b: Baby, updatedAt: number) {
  dbQueue({ kind: 'baby', key: 'baby', data: b, deleted: false, updatedAt }).catch((e) => console.error('Erreur partage', e))
}

function Footer({ shared }: { shared: boolean }) {
  const { t } = useFormat()
  return <footer>{t(shared ? 'footerShared' : 'footer')}</footer>
}
