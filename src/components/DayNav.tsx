import { useRef } from 'react'
import { isToday, isYesterday, parseDay, todayStr } from '#/lib/dates'
import { useFormat } from '#/lib/format'

export function DayNav({ viewDate, onGo }: { viewDate: Date; onGo: (d: Date) => void }) {
  const { t, locale } = useFormat()
  const picker = useRef<HTMLInputElement>(null)
  const dateStr = todayStr(viewDate)
  const today = isToday(dateStr)
  const label = today
    ? t('today')
    : isYesterday(dateStr)
      ? t('yesterday')
      : viewDate.toLocaleDateString(locale, { day: 'numeric', month: 'long' })

  const shift = (days: number) => {
    const d = new Date(viewDate)
    d.setDate(d.getDate() + days)
    onGo(d)
  }
  const openPicker = () => {
    const el = picker.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return } catch (e) {}
    }
    el.focus()
    el.click()
  }

  return (
    <div className="day-nav">
      <button id="prev-day" aria-label={t('prevDay')} onClick={() => shift(-1)}>‹</button>
      <div
        className="day-label"
        id="day-label"
        role="button"
        tabIndex={0}
        title={t('pickDate')}
        onClick={openPicker}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPicker() }
        }}
      >
        {label}
      </div>
      <input
        ref={picker}
        type="date"
        className="day-picker"
        id="day-picker"
        aria-label={t('pickDate')}
        value={dateStr}
        max={todayStr(new Date())}
        onChange={(e) => { if (e.target.value) onGo(parseDay(e.target.value)) }}
      />
      <button
        id="next-day"
        aria-label={t('nextDay')}
        style={{ visibility: today ? 'hidden' : 'visible' }}
        onClick={() => { if (!today) shift(1) }}
      >
        ›
      </button>
    </div>
  )
}
