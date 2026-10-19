import { useState } from 'react'
import type { MilkType } from '#/lib/db'
import { useFormat } from '#/lib/format'
import type { MilkPrefs } from '#/lib/settings'

type Props = {
  past: boolean
  quick: number[]
  milk: MilkPrefs
  onMilkType: (type: MilkType) => void
  customTime: string
  onCustomTime: (v: string) => void
  onAdd: (ml: number) => void
}

export function AddFeed({ past, quick, milk, onMilkType, customTime, onCustomTime, onAdd }: Props) {
  const { t, mlToDisplay, unitLabel, displayToMl } = useFormat()
  const [amount, setAmount] = useState('')

  const addCustom = () => {
    const raw = parseFloat(amount)
    if (!raw || raw <= 0) return
    onAdd(displayToMl(raw))
    setAmount('')
  }

  return (
    <>
      {milk.track ? (
        <div className="section-head">
          <p className="section-label">{t('quickAdd')}</p>
          <MilkToggle value={milk.last} onChange={onMilkType} idPrefix="milk" />
        </div>
      ) : (
        <p className="section-label">{t('quickAdd')}</p>
      )}
      <div className="quick-grid" id="quick-grid">
        {quick.map((ml, i) => (
          <button key={i} onClick={() => onAdd(ml)}>
            {mlToDisplay(ml) + ' ' + unitLabel}
          </button>
        ))}
      </div>

      <div className={'custom-row' + (past ? ' past' : '')}>
        <input
          type="number"
          id="custom-amount"
          placeholder={t('customPlaceholder')}
          inputMode="decimal"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') addCustom() }}
        />
        <input
          type="time"
          id="custom-time"
          aria-label={t('feedTime')}
          value={customTime}
          onChange={(e) => onCustomTime(e.target.value)}
        />
        <button id="custom-add" onClick={addCustom}>{t('add')}</button>
      </div>
    </>
  )
}

export function MilkToggle({ value, onChange, idPrefix }: { value: MilkType | undefined; onChange: (t: MilkType) => void; idPrefix: string }) {
  const { t } = useFormat()
  return (
    <div className="milk-toggle" role="group" aria-label={t('milkTitle')}>
      {(['formula', 'breast'] as const).map((m) => (
        <button
          key={m}
          type="button"
          id={idPrefix + '-' + m}
          className={value === m ? 'active' : ''}
          aria-pressed={value === m}
          onClick={() => onChange(m)}
        >
          {t(m === 'formula' ? 'milkFormula' : 'milkBreast')}
        </button>
      ))}
    </div>
  )
}
