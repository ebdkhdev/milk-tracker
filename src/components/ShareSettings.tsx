import { useState } from 'react'
import { formatTime } from '#/lib/dates'
import { useFormat } from '#/lib/format'
import { NAME_MAX } from '#/lib/settings'
import type { SyncStatus } from '#/lib/sync'

type Props = {
  code: string | null
  status: SyncStatus
  lastSync: string | null
  name: string
  onName: (name: string) => void
  onSendCode: () => void
  onSyncNow: () => void
  onLeave: () => void
  onDelete: () => Promise<string | null> // error message, or null
}

// Settings section: create or join a family; once in, show the code to give the other parent and the sync state.
// No QR code on purpose: on iOS a scanned QR or a tapped link opens Safari, whose storage is separate from the
// installed app, so the code is pasted inside the app instead.
export function ShareSettings({ code, status, lastSync, name, onName, onSendCode, onSyncNow, onLeave, onDelete }: Props) {
  const { t } = useFormat()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const run = (job: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    job().then((err) => { setError(err); setBusy(false) })
  }

  // new sharing goes through accounts (invitation by email); a code family is only shown to phones in one
  if (!code) return <p className="settings-note" id="share-signin-note">{t('signInToShare')}</p>

  const statusText =
    status === 'syncing' ? t('syncing')
    : status === 'offline' ? t('syncOffline')
    : status === 'error' ? t('syncError')
    : lastSync ? t('syncOk', { time: formatTime(lastSync) }) : t('syncNever')
  return (
    <>
      <label className="settings-row">
        <span>{t('deviceName')}</span>
        <input
          type="text"
          id="device-name"
          className="device-name"
          maxLength={NAME_MAX}
          autoComplete="given-name"
          defaultValue={name}
          onBlur={(e) => onName(e.target.value.trim())}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        />
      </label>
      <p className="settings-note">{t('deviceNameNote')}</p>
      <p className="settings-note" id="legacy-code-note">{t('legacyCodeNote')}</p>
      <p className="share-code" id="share-code" dir="ltr">{code}</p>
      <p className="settings-note">{t('shareCodeNote')}</p>
      <p className={'share-status' + (status === 'offline' || status === 'error' ? ' warn' : '')} id="share-status" aria-live="polite">{statusText}</p>
      <div className="data-row">
        <button className="data-btn" id="share-send" onClick={onSendCode}>{t('shareSend')}</button>
        <button className="data-btn" id="share-now" disabled={status === 'syncing'} onClick={onSyncNow}>{t('shareNow')}</button>
      </div>
      <div className="settings-actions">
        <button className="settings-reset share-leave" id="share-leave" onClick={onLeave}>{t('shareLeave')}</button>
        {!confirmDelete ? (
          <button className="settings-reset share-leave" id="share-delete" onClick={() => { setError(null); setConfirmDelete(true) }}>{t('shareDelete')}</button>
        ) : null}
      </div>
      {/* destructive: a second, explicit step instead of a browser dialog */}
      {confirmDelete ? (
        <div className="share-confirm" id="share-confirm" role="group" aria-labelledby="share-confirm-text">
          <p id="share-confirm-text">{t('shareDeleteConfirm')}</p>
          <div className="data-row">
            <button className="data-btn danger" id="share-delete-yes" disabled={busy} onClick={() => run(onDelete)}>{t('shareDeleteYes')}</button>
            <button className="data-btn" id="share-delete-no" onClick={() => setConfirmDelete(false)}>{t('cancel')}</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="settings-note share-error" id="share-error" role="alert">{error}</p> : null}
    </>
  )
}
