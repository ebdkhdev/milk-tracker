import { DEFAULT_TIERS_ML, TIER_STARTS, formatAge, tierIndexFor } from '#/lib/baby'
import type { Baby } from '#/lib/baby'
import { todayStr } from '#/lib/dates'
import { useFormat } from '#/lib/format'
import { DAILY_MIN_ML, MAX_FEED_ML, QUICK_AMOUNTS_ML } from '#/lib/settings'

type Props = {
  baby: Baby
  onChange: (b: Baby) => void
  quick: number[]
  quickSuggestion: number[] | null
  onQuick: (q: number[]) => void
  onClose: () => void
  onExport: () => void
  onImport: (file: File) => void
}

export function BabySettings({ baby, onChange, quick, quickSuggestion, onQuick, onClose, onExport, onImport }: Props) {
  const { t, unitLabel, mlToDisplay, displayToMl, formatAmount } = useFormat()
  const today = todayStr(new Date())
  const current = tierIndexFor(baby, today)

  const setTier = (i: number, raw: string) => {
    const val = parseFloat(raw)
    // ignore invalid input, and unchanged values (an oz round-trip would otherwise shift the ml value)
    if (!val || val <= 0 || val === mlToDisplay(baby.tiersMl[i])) return
    const tiersMl = baby.tiersMl.slice()
    tiersMl[i] = Math.round(displayToMl(val))
    onChange({ ...baby, tiersMl })
  }
  const setQuickAt = (i: number, raw: string) => {
    const val = parseFloat(raw)
    if (!val || val <= 0 || val === mlToDisplay(quick[i])) return
    const ml = Math.round(displayToMl(val))
    if (ml > MAX_FEED_ML) return
    const next = quick.slice()
    next[i] = ml
    onQuick(next)
  }
  const sameAs = (a: number[] | null) => !!a && a.every((v, i) => v === quick[i])

  return (
    <section className="settings-card" id="settings" aria-label={t('settings')}>
      <div className="settings-head">
        <span className="settings-title">{t('settings')}</span>
        <button className="settings-close" id="settings-close" onClick={onClose}>{t('close')}</button>
      </div>

      <p className="settings-sub settings-sub-first">{t('babyTitle')}</p>
      <label className="settings-row">
        <span>{t('birthDate')}</span>
        <span className="settings-birth">
          <input
            type="date"
            id="birth-date"
            max={today}
            value={baby.birthDate || ''}
            onChange={(e) => onChange({ ...baby, birthDate: e.target.value || null })}
          />
          {baby.birthDate ? <span className="settings-age" id="baby-age">{formatAge(t, baby.birthDate, today)}</span> : null}
        </span>
      </label>

      <p className="settings-sub">{t('minByAge')}</p>
      <div className="tiers" id="tiers">
        {TIER_STARTS.map((start, i) => {
          const next = TIER_STARTS[i + 1]
          return (
            <div key={start} className={'tier' + (i === current ? ' current' : '')}>
              <span className="tier-label">
                {next === undefined ? t('tierFrom', { a: start }) : t('tierRange', { a: start, b: next })}
              </span>
              {i === current ? <span className="tier-badge">{t('tierCurrent')}</span> : null}
              <span className="tier-input">
                <input
                  // remount when the unit or the stored value changes (ml/oz switch, reset to defaults)
                  key={unitLabel + baby.tiersMl[i]}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  aria-label={next === undefined ? t('tierFrom', { a: start }) : t('tierRange', { a: start, b: next })}
                  defaultValue={mlToDisplay(baby.tiersMl[i])}
                  onBlur={(e) => setTier(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
                <span className="unit-tag">{unitLabel}</span>
              </span>
            </div>
          )
        })}
      </div>
      <p className="settings-note">
        {baby.birthDate ? t('tiersNote') : t('noBirthDate', { v: formatAmount(DAILY_MIN_ML) })}
      </p>
      <button
        className="settings-reset"
        id="tiers-reset"
        onClick={() => onChange({ ...baby, tiersMl: DEFAULT_TIERS_ML.slice() })}
      >
        {t('resetTiers')}
      </button>

      <p className="settings-sub">{t('quickAdd')}</p>
      <div className="quick-edit" id="quick-edit">
        {quick.map((ml, i) => (
          <input
            // remount when the unit or the stored value changes (ml/oz switch, suggestion, reset)
            key={i + unitLabel + ml}
            type="number"
            inputMode="decimal"
            min="0"
            aria-label={t('quickSlot', { n: i + 1, unit: unitLabel })}
            defaultValue={mlToDisplay(ml)}
            onBlur={(e) => setQuickAt(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        ))}
      </div>
      <p className="settings-note">{t('quickNote', { unit: unitLabel })}</p>
      <div className="settings-actions">
        {quickSuggestion && !sameAs(quickSuggestion) ? (
          <button className="settings-reset" id="quick-suggest" onClick={() => onQuick(quickSuggestion)}>
            {t('quickSuggest', { v: quickSuggestion.map((v) => mlToDisplay(v)).join(' · ') })}
          </button>
        ) : null}
        {!sameAs(QUICK_AMOUNTS_ML) ? (
          <button className="settings-reset" id="quick-reset" onClick={() => onQuick(QUICK_AMOUNTS_ML.slice())}>
            {t('resetTiers')}
          </button>
        ) : null}
      </div>

      <p className="settings-sub">{t('dataTitle')}</p>
      <div className="data-row">
        <button className="data-btn" id="export-btn" onClick={onExport}>{t('exportBtn')}</button>
        <label className="data-btn" id="import-btn">
          {t('importBtn')}
          {/* no MIME check: iOS often reports an empty type for .json files; the content is validated instead */}
          <input
            type="file"
            id="import-file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0]
              e.target.value = ''
              if (f) onImport(f)
            }}
          />
        </label>
      </div>
      <p className="settings-note">{t('dataNote')}</p>
    </section>
  )
}
