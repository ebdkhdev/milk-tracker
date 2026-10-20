import { useFormat } from '#/lib/format'

export type Tab = 'feeds' | 'diapers' | 'sleep' | 'growth' | 'stats'
const ICONS: Record<Tab, string> = { feeds: '🍼', diapers: '🧷', sleep: '😴', growth: '📈', stats: '📊' }

// iOS-style tab bar, floating above the content (functional layer, so glass is in its place).
export function TabBar({ tabs, tab, onTab }: { tabs: Tab[]; tab: Tab; onTab: (t: Tab) => void }) {
  const { t } = useFormat()
  return (
    <nav className="tabbar" aria-label={t('tabsLabel')}>
      {tabs.map((x) => (
        <button key={x} id={'tab-' + x} className={x === tab ? 'active' : ''} aria-current={x === tab ? 'page' : undefined} onClick={() => onTab(x)}>
          <span className="tab-icon" aria-hidden="true">{ICONS[x]}</span>
          <span className="tab-label">{t('tab_' + x)}</span>
        </button>
      ))}
    </nav>
  )
}
