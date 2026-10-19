import { useEffect, useState } from 'react'
import { useFormat } from '#/lib/format'

type InstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<unknown> }

export function InstallBanner() {
  const { t } = useFormat()
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (ev: Event) => {
      ev.preventDefault()
      setPrompt(ev as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

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
