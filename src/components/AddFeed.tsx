import { useState } from 'react'
import { QUICK_AMOUNTS_ML } from '#/lib/settings'
import { useFormat } from '#/lib/format'

type Props = {
  past: boolean
  customTime: string
  onCustomTime: (v: string) => void
  onAdd: (ml: number) => void
}

export function AddFeed({ past, customTime, onCustomTime, onAdd }: Props) {
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
      <p className="section-label">{t('quickAdd')}</p>
      <div className="quick-grid" id="quick-grid">
        {QUICK_AMOUNTS_ML.map((ml) => (
          <button key={ml} onClick={() => onAdd(ml)}>
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
