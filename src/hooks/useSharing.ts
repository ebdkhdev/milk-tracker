import { useCallback, useEffect, useRef, useState } from 'react'
import { sanitizeBaby } from '#/lib/baby'
import type { Baby } from '#/lib/baby'
import type { T } from '#/lib/i18n'
import { createFamily, deleteFamily, formatCode, initSync, joinFamily, leaveFamily, loadSync, syncNow } from '#/lib/sync'
import type { SyncStatus } from '#/lib/sync'

type Options = {
  ready: boolean // local data migrated: syncing may start
  t: T
  showToast: (text: string) => void
  onRemoteData: () => void // records changed by the other phone: reload
  onRemoteBaby: (b: Baby) => void // baby settings changed by the other phone (store locally, don't queue)
  shareBaby: (updatedAt: number) => void // queue this phone's baby settings
  hasBirthDate: boolean
}

// Family sharing state and actions (lib/sync.ts does the work). One sync at a time; local writes schedule
// one 1.5 s later (several taps -> one request); also on start, foreground, online and every minute.
export function useSharing({ ready, t, showToast, onRemoteData, onRemoteBaby, shareBaby, hasBirthDate }: Options) {
  const [sync, setSyncState] = useState(loadSync)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // runSync is stable; it reaches the latest callbacks and texts through this ref
  const latest = useRef({ t, showToast, onRemoteData, onRemoteBaby })
  latest.current = { t, showToast, onRemoteData, onRemoteBaby }

  const stopped = useCallback((message: string) => {
    setSyncState(loadSync())
    setStatus('idle')
    latest.current.showToast(message)
  }, [])

  const runSync = useCallback(() => {
    if (!loadSync().code) return
    setStatus('syncing')
    syncNow().then((r) => {
      // deleted from the other phone: stop sharing, keep everything local
      if (r.status === 'gone') { leaveFamily().then(() => stopped(latest.current.t('familyGone'))); return }
      setStatus(r.status)
      setSyncState(loadSync())
      if (r.baby && r.baby.data) latest.current.onRemoteBaby(sanitizeBaby(r.baby.data))
      if (r.applied) latest.current.onRemoteData()
    })
  }, [stopped])

  const scheduleSync = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(runSync, 1500)
  }, [runSync])

  useEffect(() => {
    initSync(scheduleSync)
    return () => clearTimeout(timer.current)
  }, [scheduleSync])

  useEffect(() => {
    if (!ready || !sync.code) return
    runSync()
    const onVisible = () => { if (!document.hidden) runSync() }
    const id = setInterval(() => { if (!document.hidden) runSync() }, 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', runSync)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', runSync)
    }
  }, [ready, sync.code, runSync])

  // After create/join: share the baby settings too. A phone without a birth date sends them with time 0
  // and a phone with one with time 1, so joining never erases the family's birth date; later edits use now.
  const afterJoin = (message: string) => () => {
    setSyncState(loadSync())
    shareBaby(hasBirthDate ? 1 : 0)
    showToast(message)
    runSync()
    return null
  }

  return {
    code: sync.code,
    lastSync: sync.lastSync,
    status,
    runSync,
    create: () => createFamily().then(afterJoin(t('created')), () => t('createError')),
    join: (code: string) => joinFamily(code).then((r) => (r === 'ok' ? afterJoin(t('joined'))() : t(r === 'unknown' ? 'joinUnknown' : 'joinOffline'))),
    leave: () => { leaveFamily().then(() => stopped(t('left'))) },
    erase: () => deleteFamily().then((r) => {
      if (r !== 'ok') return t('deleteError')
      stopped(t('deletedShared'))
      return null
    }),
    sendCode: () => {
      if (!sync.code) return
      const text = t('inviteText', { code: formatCode(sync.code) })
      if (navigator.share) navigator.share({ text }).catch(() => {})
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showToast(t('copied'))).catch(() => {})
    },
  }
}
