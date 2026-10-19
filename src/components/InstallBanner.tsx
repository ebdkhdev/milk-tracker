import { useEffect, useState } from 'react'
import { useFormat } from '#/lib/format'

type InstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<unknown> }

const IOS_HINT_KEY = 'suivi-lait-ios-hint-v1'

// iPadOS reports itself as a Mac; touch support tells them apart.
function isIos() {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
function isStandalone() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
}
function iosHintDismissed() {
  try { return localStorage.getItem(IOS_HINT_KEY) === '1' } catch (e) { return false }
}

// Chromium fires beforeinstallprompt; Safari never does, so iOS gets written instructions instead.
export function InstallBanner() {
  const { t } = useFormat()
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState(() => isIos() && !isStandalone() && !iosHintDismissed())

  useEffect(() => {
    const onPrompt = (ev: Event) => {
      ev.preventDefault()
      setPrompt(ev as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (iosHint) {
    return (
      <div className="install-banner ios" id="ios-install-hint" style={{ display: 'flex' }}>
        <span>{t('iosInstall')}</span>
        <button
          id="ios-hint-close"
          onClick={() => {
            try { localStorage.setItem(IOS_HINT_KEY, '1') } catch (e) {}
            setIosHint(false)
          }}
        >
          {t('close')}
        </button>
      </div>
    )
  }
  if (!prompt) return null
  return (
    <div className="install-banner" id="install-banner" style={{ display: 'flex' }}>
      <span>{t('installPrompt')}</span>
      <button
        id="install-btn"
        onClick={() => {
          prompt.prompt()
          prompt.userChoice.finally(() => setPrompt(null))
        }}
      >
        {t('install')}
      </button>
    </div>
  )
}
