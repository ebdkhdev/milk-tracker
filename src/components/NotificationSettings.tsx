import { useState } from 'react'
import { useFormat } from '#/lib/format'
import { pushSupport } from '#/lib/push'
import type { PushState } from '#/lib/push'

type Props = {
  push: PushState
  shared: boolean
  reminderOn: boolean
  reminderTime: string
  onEnable: () => Promise<'ok' | 'denied' | 'error'> // must run inside the tap (permission prompt)
  onDisable: () => void
  onTest: () => void
  onChange: (p: PushState) => void
}

// Settings section for notifications that work with the app closed. Vitamin D follows the existing daily
// reminder switch and time (no second setting); the other two are per phone.
export function NotificationSettings({ push, shared, reminderOn, reminderTime, onEnable, onDisable, onTest, onChange }: Props) {
  const { t } = useFormat()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const support = pushSupport()

  if (support !== 'ok') return <p className="settings-note" id="notif-unavailable">{t(support === 'install' ? 'notifInstall' : 'notifUnsupported')}</p>
  if (!push.enabled) {
    return (
      <>
        <p className="settings-note share-intro">{t('notifIntro')}</p>
        <div className="data-row">
          <button
            className="data-btn"
            id="notif-enable"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              onEnable().then((r) => { setBusy(false); if (r !== 'ok') setError(t(r === 'denied' ? 'notifDenied' : 'notifError')) })
            }}
          >
            {t('notifEnable')}
          </button>
        </div>
        {error ? <p className="settings-note share-error" id="notif-error" role="alert">{error}</p> : null}
      </>
    )
  }
  const toggle = (id: string, label: string, checked: boolean, key: 'nextFeed' | 'partner') => (
    <label className="settings-row settings-switch">
      <span>{label}</span>
      <input type="checkbox" className="switch" role="switch" id={id} checked={checked} onChange={(e) => onChange({ ...push, [key]: e.target.checked })} />
    </label>
  )
  return (
    <>
      <p className="settings-note" id="notif-vitd">{reminderOn ? t('notifVitd', { time: reminderTime }) : t('notifVitdOff')}</p>
      {toggle('notif-next', t('notifNext'), push.nextFeed, 'nextFeed')}
      {shared ? toggle('notif-partner', t('notifPartner'), push.partner, 'partner') : null}
      <div className="settings-actions">
        <button className="settings-reset" id="notif-test" onClick={onTest}>{t('notifTest')}</button>
        <button className="settings-reset share-leave" id="notif-disable" onClick={onDisable}>{t('notifDisable')}</button>
      </div>
    </>
  )
}
