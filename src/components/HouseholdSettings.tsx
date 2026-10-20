import { useState } from 'react'
import type { Household } from '#/lib/account'
import { formatTime } from '#/lib/dates'
import { useFormat } from '#/lib/format'
import type { SyncStatus } from '#/lib/sync'

type Props = {
  household: Household | null
  emailVerified: boolean
  status: SyncStatus
  lastSync: string | null
  name: string
  onName: (name: string) => void
  onInvite: (email: string) => Promise<number> // http status
  onCancel: (id: number) => void
  onAccept: (id: number) => Promise<number>
  onDecline: (id: number) => void
  onLeave: () => void
  onErase: () => Promise<string | null>
  onSyncNow: () => void
}

// Settings section for a signed-in account: who is in the family, invitations (sent and received), sync
// state, leaving, erasing the shared data.
export function HouseholdSettings({ household, emailVerified, status, lastSync, name, onName, onInvite, onCancel, onAccept, onDecline, onLeave, onErase, onSyncNow }: Props) {
  const { t } = useFormat()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [confirmErase, setConfirmErase] = useState(false)
  const statusText =
    status === 'syncing' ? t('syncing')
    : status === 'offline' ? t('syncOffline')
    : status === 'error' ? t('syncError')
    : lastSync ? t('syncOk', { time: formatTime(lastSync) }) : t('syncNever')
  const members = household ? household.members : []

  return (
    <>
      <label className="settings-row">
        <span>{t('deviceName')}</span>
        <input type="text" id="device-name" className="device-name" maxLength={20} autoComplete="given-name" defaultValue={name}
          onBlur={(e) => onName(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      </label>
      {members.length ? (
        <ul className="members" id="members">
          {members.map((m) => <li key={m.email}>{m.you ? t('membersYou', { name: m.name || m.email }) : m.name || m.email}<span className="member-email"> · {m.email}</span></li>)}
        </ul>
      ) : null}
      <p className={'share-status' + (status === 'offline' || status === 'error' ? ' warn' : '')} id="share-status" aria-live="polite">{statusText}</p>

      {household && household.received.map((i) => (
        <div className="share-confirm" key={i.id} id={'invite-' + i.id}>
          <p>{t('invitedBy', { from: i.from })}</p>
          {!emailVerified ? <p className="settings-note">{t('verifyFirst')}</p> : null}
          <div className="data-row">
            <button className="data-btn primary" id={'accept-' + i.id} disabled={!emailVerified} onClick={async () => {
              const s = await onAccept(i.id)
              setMessage(s === 200 ? { text: t('joinedHousehold'), error: false } : { text: t(s === 403 ? 'verifyFirst' : 'err_GENERIC'), error: s !== 200 })
            }}>{t('acceptInvite')}</button>
            <button className="data-btn" id={'decline-' + i.id} onClick={() => onDecline(i.id)}>{t('declineInvite')}</button>
          </div>
        </div>
      ))}

      <p className="settings-sub">{t('inviteTitle')}</p>
      <form className="share-join" onSubmit={async (e) => {
        e.preventDefault()
        const s = await onInvite(email)
        setMessage(s === 200 ? { text: t('invited', { email }), error: false } : { text: t(s === 0 ? 'err_OFFLINE' : 'err_GENERIC'), error: true })
        if (s === 200) setEmail('')
      }}>
        <input type="email" id="invite-email" autoComplete="off" placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value.trim())} />
        <button type="submit" className="data-btn" id="invite-submit" disabled={!email}>{t('inviteBtn')}</button>
      </form>
      <p className="settings-note">{t('inviteNote')}</p>
      {household && household.sent.map((i) => (
        <div className="settings-row pending-invite" key={i.id}>
          <span>{t('pending', { email: i.email })}</span>
          <button className="settings-reset" id={'cancel-' + i.id} onClick={() => onCancel(i.id)}>{t('cancelInvite')}</button>
        </div>
      ))}
      {message ? <p className={'settings-note' + (message.error ? ' share-error' : '')} id="household-message" role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}

      <div className="settings-actions">
        <button className="settings-reset" id="share-now" disabled={status === 'syncing'} onClick={onSyncNow}>{t('shareNow')}</button>
        {members.length > 1 ? <button className="settings-reset share-leave" id="leave-household" onClick={onLeave}>{t('leaveHousehold')}</button> : null}
        {!confirmErase ? <button className="settings-reset share-leave" id="share-delete" onClick={() => setConfirmErase(true)}>{t('shareDelete')}</button> : null}
      </div>
      {confirmErase ? (
        <div className="share-confirm" id="share-confirm">
          <p>{t('shareDeleteConfirm')}</p>
          <div className="data-row">
            <button className="data-btn danger" id="share-delete-yes" onClick={async () => { const err = await onErase(); setConfirmErase(false); if (err) setMessage({ text: err, error: true }) }}>{t('shareDeleteYes')}</button>
            <button className="data-btn" id="share-delete-no" onClick={() => setConfirmErase(false)}>{t('cancel')}</button>
          </div>
        </div>
      ) : null}
    </>
  )
}
