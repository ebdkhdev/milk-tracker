import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddFeed } from '#/components/AddFeed'
import { BackupReminder } from '#/components/BackupReminder'
import { BabySettings } from '#/components/BabySettings'
import { DayNav } from '#/components/DayNav'
import { Diapers } from '#/components/Diapers'
import { Sleep } from '#/components/Sleep'
import { ongoingSleep, sleepMinutesOn, sleepsOn } from '#/lib/sleep'
import type { DiaperKind } from '#/components/Diapers'
import { FeedList } from '#/components/FeedList'
import { Header } from '#/components/Header'
import { InstallBanner } from '#/components/InstallBanner'
import { NotificationSettings } from '#/components/NotificationSettings'
import { Report } from '#/components/Report'
import { ShareSettings } from '#/components/ShareSettings'
import { Stats, buildRows } from '#/components/Stats'
import { TabBar } from '#/components/TabBar'
import type { Tab } from '#/components/TabBar'
import { Toast } from '#/components/Toast'
import { TotalCard } from '#/components/TotalCard'
import { VitaminDCard } from '#/components/VitaminDCard'
import { useClock } from '#/hooks/useClock'
import { useData } from '#/hooks/useData'
import { useSharing } from '#/hooks/useSharing'
import { useToast } from '#/hooks/useToast'
import { buildBackup, parseBackup, shareOrDownload } from '#/lib/backup'
import { FIRST_BABY, babyList, babyOf, loadBaby, loadCurrentBaby, loadProfiles, minimumFor, newBabyId, sanitizeProfile, saveBaby, saveCurrentBaby, saveProfiles } from '#/lib/baby'
import type { Baby, Profile } from '#/lib/baby'
import { isToday, nowHHMM, parseDay, timeOnDate, todayStr } from '#/lib/dates'
import { dbAdd, dbDelete, dbDeleteDay, dbDeleteEvent, dbImport, dbPut, dbPutDaily, dbPutDay, dbPutEvent, dbQueue, newId } from '#/lib/db'
import type { Change, Daily, EventRecord, Feed, MilkType } from '#/lib/db'
import { lastFeedText, rhythmText } from '#/lib/feedText'
import { FormatProvider, useFormat } from '#/lib/format'
import { RTL_LANGS, loadLang, makeT, saveLang } from '#/lib/i18n'
import type { Lang, Unit } from '#/lib/i18n'
import { notificationsAvailable, reminderIsDue, showReminderNotification } from '#/lib/reminder'
import { disablePush, enablePush, loadPush, refreshPush, savePush, testPush, updatePush } from '#/lib/push'
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
  const [baby, setBabyState] = useState<Baby>(loadBaby) // the first baby's settings (shared as kind "baby")
  const [profiles, setProfilesState] = useState<Profile[]>(loadProfiles) // names/sex, and the other babies
  const [currentId, setCurrentId] = useState(loadCurrentBaby) // per phone, not shared
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
  const [tab, setTabState] = useState<Tab>('feeds')

  const dateStr = todayStr(viewDate)
  const viewingToday = isToday(dateStr)
  const t = useMemo(() => makeT(lang), [lang])
  const { now, refresh: refreshClock } = useClock()
  const { ready, reload, allFeeds, allDaily: firstDaily, allDays, allEvents } = useData()
  // ---- the selected baby: everything below shows its data ----
  const babies = useMemo(() => babyList(baby, profiles), [baby, profiles])
  const current = babies.find((b) => b.id === currentId) || babies[0]
  const feeds = useMemo(() => allFeeds.filter((f) => babyOf(f) === current.id), [allFeeds, current.id])
  const allDaily = useMemo<Daily[] | null>(
    () => (current.id === FIRST_BABY ? firstDaily : firstDaily && allDays.filter((d) => d.babyId === current.id)),
    [current.id, firstDaily, allDays],
  )
  const entries = useMemo(() => feeds.filter((f) => f.date === dateStr).sort((a, b) => +new Date(b.time) - +new Date(a.time)), [feeds, dateStr])
  const dayRecord = (allDaily || []).find((d) => d.date === dateStr) || null
  const events = useMemo(() => allEvents.filter((e) => babyOf(e) === current.id), [allEvents, current.id])
  const dayEvents = (type: string) => events.filter((e) => e.type === type && e.date === dateStr).sort((a, b) => +new Date(b.time) - +new Date(a.time))
  const { toast, showToast, closeToast } = useToast()
  // after every local write: read the data again, and refresh the clock so "last bottle" is never ahead
  const bump = () => { reload(); refreshClock() }

  const saveBabyLocally = (b: Baby) => { saveBaby(b); setBabyState(b) }
  const saveProfilesLocally = (list: Profile[]) => { saveProfiles(list); setProfilesState(list) }
  // profiles from the other phone: newest copy wins, a deletion removes the baby here too
  const applyRemoteProfiles = (changes: Change[]) => {
    let list = loadProfiles()
    for (const c of changes.sort((a, b) => a.updatedAt - b.updatedAt)) {
      const local = list.find((p) => p.id === c.key)
      if (local && (local.updatedAt || 0) > c.updatedAt) continue
      if (c.deleted) { if (c.key !== FIRST_BABY) list = list.filter((p) => p.id !== c.key) }
      else list = [...list.filter((p) => p.id !== c.key), { ...sanitizeProfile(c.data, c.key), updatedAt: c.updatedAt }]
    }
    list.sort((a, b) => (a.id === FIRST_BABY ? -1 : b.id === FIRST_BABY ? 1 : 0))
    saveProfilesLocally(list)
  }
  const sharing = useSharing({
    ready,
    t,
    showToast,
    onRemoteData: reload,
    onRemoteBaby: saveBabyLocally,
    onRemoteProfiles: applyRemoteProfiles,
    // after create/join: the first baby's settings and every profile (see useSharing for the 0/1 trick)
    shareBaby: (updatedAt) => {
      queueBaby(baby, updatedAt)
      profiles.forEach((p) => queueProfile(p, p.id === FIRST_BABY ? (p.name || p.sex ? 1 : 0) : p.updatedAt || 1))
    },
    hasBirthDate: !!baby.birthDate,
  })
  // baby settings are shared with the family (quick amounts, milk type preference and reminder stay per phone)
  const setBaby = (b: Baby) => { saveBabyLocally(b); queueBaby(b, Date.now()) }
  const setProfile = (p: Profile) => {
    const next = { ...p, updatedAt: Date.now() }
    saveProfilesLocally(loadProfiles().map((x) => (x.id === p.id ? next : x)))
    queueProfile(next, next.updatedAt)
  }
  // the selected baby's settings: the first baby's live in `baby`, the others' in their profile
  const setCurrentSettings = (b: Baby) => {
    if (current.id === FIRST_BABY) setBaby(b)
    else setProfile({ ...profiles.find((p) => p.id === current.id)!, birthDate: b.birthDate, tiersMl: b.tiersMl })
  }
  const selectBaby = (id: string) => { saveCurrentBaby(id); setCurrentId(id); setEditingId(null) }
  const addBaby = () => {
    const p: Profile = { ...sanitizeProfile(null, newBabyId()), name: t('babyN', { n: profiles.length + 1 }), updatedAt: Date.now() }
    saveProfilesLocally([...loadProfiles(), p])
    queueProfile(p, p.updatedAt!)
    selectBaby(p.id)
  }
  // removes the selected baby (never the first) and all its records, through the normal delete paths so the
  // other phone deletes them too
  const removeBaby = () => {
    const id = current.id
    if (id === FIRST_BABY) return
    const jobs: Promise<void>[] = [
      ...allFeeds.filter((f) => babyOf(f) === id).map((f) => dbDelete(f.id, id)),
      ...allDays.filter((d) => d.babyId === id).map((d) => dbDeleteDay(d.id)),
      ...allEvents.filter((e) => e.babyId === id).map((e) => dbDeleteEvent(e.id)),
    ]
    Promise.all(jobs).then(() => {
      saveProfilesLocally(loadProfiles().filter((p) => p.id !== id))
      dbQueue({ kind: 'profile', key: id, data: null, deleted: true, updatedAt: Date.now() }).catch(() => {})
      selectBaby(FIRST_BABY)
      bump()
      showToast(t('babyRemoved'))
    }).catch((e) => console.error('Erreur suppression bébé', e))
  }

  useEffect(() => {
    // ask the browser not to evict our data under storage pressure (best effort, no prompt on most browsers)
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW', e))
    }
  }, [])

  // switching tab: leaves the report and edit mode, starts at the top
  const setTab = (next: Tab) => {
    setTabState(next)
    setReportOpen(false)
    setEditingId(null)
    window.scrollTo(0, 0)
  }

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
  // for the reminder notifications: given to every baby today
  const allGivenToday = !!firstDaily && babies.every((b) =>
    b.id === FIRST_BABY ? firstDaily.some((r) => r.date === today && r.vitaminD) : allDays.some((d) => d.babyId === b.id && d.date === today && d.vitaminD))
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
  // next bottle: from the selected baby's rhythm (one shared reminder per family; fine for twins fed together)
  const rhythm = useMemo(() => feedingRhythm(feeds, now), [feeds, now])
  const lastFeedAt = useMemo(() => feeds.reduce((m, f) => Math.max(m, Date.parse(f.time) <= now.getTime() + 60e3 ? Date.parse(f.time) : 0), 0), [feeds, now])
  const pushDevice: PushDevice = {
    lang, unit, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, name: deviceName,
    prefs: { vitd: reminder.enabled, vitdTime: reminder.time, nextFeed: push.nextFeed, partner: push.partner },
    vitdGivenDate: allGivenToday ? today : null,
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

  const rows = useMemo(() => buildRows(feeds, allDaily || [], period, now, current, events), [feeds, allDaily, period, now, current, events])

  // average interval over the stats period (from the start of its first day to now)
  const periodInterval = useMemo(() => {
    const from = parseDay(rows[rows.length - 1].date).getTime()
    return averageInterval(feeds, from, now.getTime() + 60 * 1000)
  }, [feeds, rows, now])

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
    if (current.id !== FIRST_BABY) feed.babyId = current.id
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
    dbDelete(id, entry && entry.babyId)
      .then(() => {
        bump()
        if (entry) showToast(t('deleted'), () => { dbPut(entry).then(bump).catch((e) => console.error("Erreur d'annulation", e)) })
      })
      .catch((e) => console.error('Erreur de suppression', e))
  }

  // Built from the data already in state so share() stays inside the click (required by Safari).
  const exportData = () => {
    const text = buildBackup(allFeeds, firstDaily || [], baby, quick, { days: allDays, events: allEvents, profiles })
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
        return dbImport(parsed.feeds, parsed.daily, parsed.days, parsed.events).then(() => {
          // a new phone (no birth date yet) takes the file's baby settings; otherwise this phone's settings win
          if (parsed.baby && !baby.birthDate) setBaby(parsed.baby)
          // babies from the file that this phone doesn't have yet (and the first baby's name if unset)
          const local = loadProfiles()
          parsed.profiles.forEach((p) => {
            const mine = local.find((x) => x.id === p.id)
            if (!mine) { saveProfilesLocally([...loadProfiles(), p]); queueProfile(p, p.updatedAt || 1) }
            else if (p.id === FIRST_BABY && !mine.name && p.name) setProfile({ ...mine, name: p.name, sex: mine.sex || p.sex })
          })
          if (parsed.quick && isDefaultQuick(quick)) { saveQuick(parsed.quick); setQuickState(parsed.quick) }
          bump()
          showToast(t('imported', { n: parsed.feeds.length }) + (parsed.skipped ? t('importSkipped', { n: parsed.skipped }) : ''))
        })
      })
      .catch((e) => { console.error('Erreur import', e); showToast(t('importError')) })
  }

  // ---- diapers, sleep, growth: events of the selected baby ----
  const eventTime = () => (viewingToday ? new Date().toISOString() : timeOnDate(dateStr, customTime || '12:00'))
  const addEvent = (e: { type: string; date: string; time: string; [k: string]: unknown }) => {
    const rec: EventRecord = { ...e, id: newId() }
    if (current.id !== FIRST_BABY) rec.babyId = current.id
    if (deviceName && sharing.code) rec.by = deviceName
    return dbPutEvent(rec).then(bump).catch((err) => console.error("Erreur d'enregistrement", err))
  }
  const removeEvent = (e: EventRecord, message: string) => {
    dbDeleteEvent(e.id)
      .then(() => {
        bump()
        showToast(message, () => { dbPutEvent(e).then(bump).catch((err) => console.error("Erreur d'annulation", err)) })
      })
      .catch((err) => console.error('Erreur de suppression', err))
  }
  const addDiaper = (kind: DiaperKind) => {
    const time = eventTime()
    addEvent({ type: 'diaper', diaper: kind, time, date: dateStr })
  }

  // sleep: one ongoing period at most per baby (start without end)
  const ongoing = ongoingSleep(events)
  const startSleep = () => { if (!ongoing) addEvent({ type: 'sleep', time: new Date().toISOString(), end: null, date: todayStr(new Date()) }) }
  const stopSleep = (endHHMM?: string) => {
    if (!ongoing) return
    let end = new Date()
    if (endHHMM) {
      // a corrected wake-up: the first such time after the start
      const [h, m] = endHHMM.split(':').map(Number)
      end = new Date(Date.parse(ongoing.time))
      end.setHours(h, m, 0, 0)
      if (end.getTime() <= Date.parse(ongoing.time)) end.setDate(end.getDate() + 1)
    }
    dbPutEvent({ ...ongoing, end: end.toISOString() }).then(bump).catch((err) => console.error('Erreur sommeil', err))
  }
  // a past sleep on the viewed day; an end before the start means it ended the next morning
  const addSleep = (fromHHMM: string, toHHMM: string): string | null => {
    const start = new Date(timeOnDate(dateStr, fromHHMM))
    const end = new Date(timeOnDate(dateStr, toHHMM))
    if (end <= start) end.setDate(end.getDate() + 1)
    if (end.getTime() - start.getTime() >= 24 * 3600e3 || end.getTime() > Date.now() + 60e3) return t('sleepInvalid')
    addEvent({ type: 'sleep', time: start.toISOString(), end: end.toISOString(), date: dateStr })
    return null
  }

  // the first baby's vitamin D stays in "daily" (as before); the others' in "days"
  const toggleVitaminD = () => {
    const given = !(dayRecord && dayRecord.vitaminD)
    const rec = { date: dateStr, vitaminD: given, vitaminDTime: given ? new Date().toISOString() : null }
    ;(current.id === FIRST_BABY ? dbPutDaily(rec) : dbPutDay({ ...rec, id: current.id + '|' + dateStr, babyId: current.id }))
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
          babies={babies.length > 1 ? babies.map((b, i) => ({ id: b.id, name: b.name || t('babyN', { n: i + 1 }) })) : null}
          currentBaby={current.id}
          onBaby={selectBaby}
          onLang={(l) => { saveLang(l); setLang(l) }}
          onUnit={(u) => { saveUnit(u); setUnit(u) }}
          settingsOpen={settingsOpen}
          onSettings={() => setSettingsOpen((o) => !o)}
        />
        {reportOpen ? (
          <Report
            rows={rows}
            feeds={feeds}
            baby={current}
            period={period}
            avgIntervalMin={periodInterval}
            onPeriod={setPeriod}
            onClose={() => { reportClosed.current = true; setReportOpen(false) }}
            onShared={() => showToast(t('copied'))}
          />
        ) : <>
        {settingsOpen ? (
          <BabySettings
            baby={current}
            onChange={setCurrentSettings}
            babies={babies}
            onProfile={(name, sex) => setProfile({ ...profiles.find((p) => p.id === current.id)!, name, sex })}
            onAddBaby={addBaby}
            onRemoveBaby={removeBaby}
            quick={quick}
            quickSuggestion={suggestQuick(feeds, now)}
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
                onDisable={() => { setPushState({ ...push, enabled: false }); disablePush(push) }}
                onTest={() => { testPush(push).then((ok) => showToast(t(ok ? 'notifTestSent' : 'notifError'))) }}
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
        {tab === 'feeds' ? <>
        <DayNav viewDate={viewDate} onGo={goToDate} />
        <TotalCard
          totalMl={entries.reduce((s, e) => s + e.ml, 0)}
          count={entries.length}
          dateStr={dateStr}
          minMl={minimumFor(current, dateStr)}
          birthDate={current.birthDate}
          lastFeed={viewingToday ? lastFeedText(feeds, now, t) : null}
          rhythm={viewingToday ? rhythmText(feeds, now, t) : null}
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
        </> : null}
        {tab === 'diapers' ? <>
        <DayNav viewDate={viewDate} onGo={goToDate} />
        <Diapers
          events={dayEvents('diaper')}
          past={!viewingToday}
          customTime={customTime}
          onCustomTime={setCustomTime}
          onAdd={addDiaper}
          onDelete={(e) => removeEvent(e, t('diaperDeleted'))}
        />
        </> : null}
        {tab === 'sleep' ? <>
        <DayNav viewDate={viewDate} onGo={goToDate} />
        <Sleep
          sleeps={sleepsOn(events, dateStr, now.getTime())}
          ongoing={ongoing}
          totalMin={sleepMinutesOn(events, dateStr, now.getTime())}
          now={now}
          onStart={startSleep}
          onStop={stopSleep}
          onAdd={addSleep}
          onDelete={(e) => removeEvent(e, t('sleepDeleted'))}
        />
        </> : null}
        {tab === 'stats' ? <Stats
          rows={rows}
          period={period}
          viewing={dateStr}
          onPeriod={setPeriod}
          avgIntervalMin={periodInterval}
          onOpen={(ds) => { goToDate(parseDay(ds)); setTab('feeds') }}
          onReport={() => { setSettingsOpen(false); setReportOpen(true) }}
        /> : null}
        <Footer shared={!!sharing.code} push={push.enabled} />
        </>}
      </div>
      <TabBar tabs={['feeds', 'diapers', 'sleep', 'stats']} tab={tab} onTab={setTab} />
      <Toast toast={toast} onDone={closeToast} />
    </FormatProvider>
  )
}

// the baby settings change sent to the family (a no-op when this phone isn't sharing)
function queueBaby(b: Baby, updatedAt: number) {
  dbQueue({ kind: 'baby', key: 'baby', data: b, deleted: false, updatedAt }).catch((e) => console.error('Erreur partage', e))
}
// a baby's profile (name, sex; the other babies' settings too). The first baby's profile carries name and sex
// only: its settings stay in kind "baby", which older apps rewrite without the new fields.
function queueProfile(p: Profile, updatedAt: number) {
  const data = p.id === FIRST_BABY ? { id: p.id, name: p.name, sex: p.sex } : { id: p.id, name: p.name, sex: p.sex, birthDate: p.birthDate, tiersMl: p.tiersMl }
  dbQueue({ kind: 'profile', key: p.id, data, deleted: false, updatedAt }).catch((e) => console.error('Erreur partage', e))
}

function Footer({ shared, push }: { shared: boolean; push: boolean }) {
  const { t } = useFormat()
  return <footer>{t(shared ? 'footerShared' : push ? 'footerPush' : 'footer')}</footer>
}
