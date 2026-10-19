import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { LOCALES, makeT } from './i18n'
import type { Lang, T, Unit } from './i18n'
import { ML_PER_OZ } from './settings'

// Language + unit dependent helpers, shared by every component.
export type Format = {
  lang: Lang
  unit: Unit
  locale: string
  t: T
  unitLabel: string
  mlToDisplay: (ml: number) => number
  displayToMl: (val: number) => number
  formatAmount: (ml: number) => string
}

const FormatContext = createContext<Format | null>(null)

export function FormatProvider({ lang, unit, children }: { lang: Lang; unit: Unit; children: ReactNode }) {
  const value = useMemo<Format>(() => {
    const t = makeT(lang)
    const unitLabel = t('unit_' + unit)
    const mlToDisplay = (ml: number) =>
      unit === 'oz' ? Math.round((ml / ML_PER_OZ) * 10) / 10 : Math.round(ml)
    return {
      lang,
      unit,
      locale: LOCALES[lang],
      t,
      unitLabel,
      mlToDisplay,
      displayToMl: (val) => (unit === 'oz' ? val * ML_PER_OZ : val),
      formatAmount: (ml) => mlToDisplay(ml) + ' ' + unitLabel,
    }
  }, [lang, unit])
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>
}

export function useFormat() {
  const f = useContext(FormatContext)
  if (!f) throw new Error('useFormat outside FormatProvider')
  return f
}
