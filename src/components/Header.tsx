import type { Lang, Unit } from '#/lib/i18n'
import { useFormat } from '#/lib/format'

export function Header({ onLang, onUnit }: { onLang: (l: Lang) => void; onUnit: (u: Unit) => void }) {
  const { t, lang, unit } = useFormat()
  return (
    <header>
      <div className="brand">🍼 Milk Tracker</div>
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
      </div>
    </header>
  )
}
