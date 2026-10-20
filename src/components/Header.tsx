import { useLayoutEffect, useRef, useState } from 'react'
import type { Lang, Unit } from '#/lib/i18n'
import { useFormat } from '#/lib/format'

type Props = { onLang: (l: Lang) => void; onUnit: (u: Unit) => void; settingsOpen: boolean; onSettings: () => void }

export function Header({ onLang, onUnit, settingsOpen, onSettings }: Props) {
  const { t, lang, unit } = useFormat()
  const compact = useCompactBrand(lang)
  return (
    <header ref={compact.ref} className={compact.on ? 'compact' : undefined}>
      <div className="brand"><span className="brand-icon">🍼</span> <span className="brand-name">Milk Tracker</span></div>
      <div className="header-controls">
        <select
          id="lang-select"
          className="lang-select"
          aria-label={t('language')}
          value={lang}
          onChange={(e) => onLang(e.target.value as Lang)}
        >
          <option value="fr" lang="fr">FR</option>
          <option value="en" lang="en">EN</option>
          <option value="ar" lang="ar">عربي</option>
        </select>
        <div className="unit-toggle" role="group" aria-label={t('unitGroup')}>
          {(['ml', 'oz'] as const).map((u) => (
            <button key={u} id={'unit-' + u} className={unit === u ? 'active' : ''} onClick={() => onUnit(u)}>
              {t('unit_' + u)}
            </button>
          ))}
        </div>
        <button
          id="settings-btn"
          className={'settings-btn' + (settingsOpen ? ' active' : '')}
          aria-label={t('settings')}
          aria-expanded={settingsOpen}
          title={t('settings')}
          onClick={onSettings}
        >
          ⚙︎
        </button>
      </div>
    </header>
  )
}

// Shows only 🍼 when "Milk Tracker" doesn't fit next to the controls, measured with the font actually used
// (system fonts differ a lot between devices), instead of letting it end in "Milk Tr…". The name stays in
// the accessible text either way (visually hidden, not removed).
function useCompactBrand(lang: Lang) {
  const ref = useRef<HTMLElement>(null)
  const [on, setOn] = useState(false)
  useLayoutEffect(() => {
    const header = ref.current
    if (!header) return
    const measure = () => {
      const icon = header.querySelector<HTMLElement>('.brand-icon')
      const name = header.querySelector<HTMLElement>('.brand-name')
      const controls = header.querySelector<HTMLElement>('.header-controls')
      if (!icon || !name || !controls) return
      const cs = getComputedStyle(header)
      const free = header.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.columnGap || '0') - controls.offsetWidth
      // scrollWidth gives the name's natural width even while it is visually hidden
      const needed = icon.offsetWidth + name.scrollWidth + parseFloat(getComputedStyle(name).fontSize) * 0.3
      setOn(needed > free - 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(header)
    const controls = header.querySelector('.header-controls')
    if (controls) ro.observe(controls)
    if (document.fonts) document.fonts.ready.then(measure).catch(() => {})
    return () => ro.disconnect()
  }, [lang])
  return { ref, on }
}
