import { useEffect, useState } from 'react'
import { useFormat } from '#/lib/format'

export type Tab = 'feeds' | 'diapers' | 'sleep' | 'growth' | 'stats'
const ICONS: Record<Tab, string> = { feeds: '🍼', diapers: '🧷', sleep: '😴', growth: '📈', stats: '📊' }

// iOS-style tab bar, floating above the content (functional layer, so glass is in its place).
export function TabBar({ tabs, tab, onTab }: { tabs: Tab[]; tab: Tab; onTab: (t: Tab) => void }) {
  const { t } = useFormat()
  const typing = useTyping()
  return (
    <nav className={'tabbar' + (typing ? ' hidden' : '')} aria-label={t('tabsLabel')} aria-hidden={typing || undefined}>
      {tabs.map((x) => (
        <button key={x} id={'tab-' + x} className={x === tab ? 'active' : ''} aria-current={x === tab ? 'page' : undefined} onClick={() => onTab(x)}>
          <span className="tab-icon" aria-hidden="true">{ICONS[x]}</span>
          <span className="tab-label">{t('tab_' + x)}</span>
        </button>
      ))}
    </nav>
  )
}

// True while a text field has focus: the bar is hidden then, as iOS does, so the keyboard never pushes it
// over the field being typed in.
function useTyping() {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes((el as HTMLInputElement).type)))
    const onIn = (e: FocusEvent) => setTyping(isField(e.target))
    const onOut = (e: FocusEvent) => setTyping(isField(e.relatedTarget))
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut) }
  }, [])
  return typing
}
