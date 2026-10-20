// WHO Child Growth Standards, 0-24 months (src/lib/who-growth.json, imported by scripts/who-import.mjs).
// The LMS method gives, for an age, the value at any z-score and the z-score (so the percentile) of a value.
import who from './who-growth.json' with { type: 'json' }
import type { Sex } from './baby'

export type Measure = 'weight' | 'length' | 'head' // kg, cm (length lying down), cm
type LMS = [number, number, number]
const TABLE = who.lms as Record<Measure, Record<'f' | 'm', LMS[]>>
export const MAX_MONTHS = 24
// the curves drawn: 3rd, 15th, 50th, 85th and 97th percentiles (the WHO's usual set)
export const CURVES: { p: number; z: number }[] = [
  { p: 3, z: -1.880794 }, { p: 15, z: -1.036433 }, { p: 50, z: 0 }, { p: 85, z: 1.036433 }, { p: 97, z: 1.880794 },
]

// Age in months (average month length), as the WHO monthly tables use completed months.
export function ageMonths(birthDate: string, dateStr: string) {
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [y, m, d] = dateStr.split('-').map(Number)
  const days = (Date.UTC(y, m - 1, d) - Date.UTC(by, bm - 1, bd)) / 86400000
  return days / 30.4375
}

// L, M, S at an age, interpolated between monthly rows; null outside 0-24 months or without a sex.
export function lmsAt(measure: Measure, sex: Sex, months: number): LMS | null {
  if (!sex || !(months >= 0) || months > MAX_MONTHS) return null
  const rows = TABLE[measure][sex]
  const i = Math.min(Math.floor(months), MAX_MONTHS - 1)
  const f = months - i
  return [0, 1, 2].map((k) => rows[i][k] + (rows[i + 1][k] - rows[i][k]) * f) as LMS
}

export const valueAtZ = ([L, M, S]: LMS, z: number) => (L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L))
export const zOf = ([L, M, S]: LMS, x: number) => (L === 0 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S))

// standard normal cumulative distribution (Abramowitz-Stegun 26.2.17, error < 1e-7)
export function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2)
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z > 0 ? 1 - p : p
}

// Percentile of a measurement (rounded, kept within 1-99 as charts do), or null when it can't be placed.
export function percentile(measure: Measure, sex: Sex, months: number, value: number): number | null {
  const lms = lmsAt(measure, sex, months)
  if (!lms || !(value > 0)) return null
  return Math.min(99, Math.max(1, Math.round(normalCdf(zOf(lms, value)) * 100)))
}

// plausible ranges, to catch typing mistakes (grams typed as kilograms, metres as centimetres…)
export const RANGES: Record<Measure, [number, number]> = { weight: [0.5, 30], length: [30, 120], head: [25, 60] }
export const SOURCE = { url: who.source, retrieved: who.retrieved }
