// WHO growth maths (src/lib/growth.ts) against the published tables' own percentile columns.
import { readFileSync } from 'node:fs'
import { check, equal, suite } from './lib/assert.mjs'

export async function run() {
  suite('Growth (WHO LMS)')
  const g = await import('../src/lib/growth.ts')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/who-check.json', import.meta.url), 'utf8'))
  let worst = 0, rows = 0
  for (const measure of ['weight', 'length', 'head']) for (const sex of ['m', 'f']) {
    fixture.check[measure][sex].forEach(([lo, mid, hi], month) => {
      const lms = g.lmsAt(measure, sex, month)
      for (const [z, expected] of [[-2, lo], [0, mid], [2, hi]]) worst = Math.max(worst, Math.abs(g.valueAtZ(lms, z) - expected) / expected)
      rows++
    })
  }
  check(`LMS formula reproduces P2.3 / P50 / P97.7 of all ${rows} rows (worst ${(worst * 100).toFixed(3)} %)`, worst < 0.001)
  equal('median is the 50th percentile', g.percentile('weight', 'f', 6, g.lmsAt('weight', 'f', 6)[1]), 50)
  equal('normal distribution', [Math.round(g.normalCdf(0) * 1e6) / 1e6, Math.round(g.normalCdf(1.959964) * 1000) / 1000], [0.5, 0.975])
  equal('round trip value -> z -> value', Math.round(g.valueAtZ(g.lmsAt('length', 'm', 9.3), g.zOf(g.lmsAt('length', 'm', 9.3), 71.2)) * 100) / 100, 71.2)
  const between = g.lmsAt('weight', 'm', 2.5)
  const [a, b] = [g.lmsAt('weight', 'm', 2), g.lmsAt('weight', 'm', 3)]
  check('half-month interpolates between monthly rows', Math.abs(between[1] - (a[1] + b[1]) / 2) < 1e-9)
  equal('outside 0-24 months or without sex: no percentile', [g.percentile('weight', 'm', 25, 12), g.percentile('weight', null, 3, 6)], [null, null])
  equal('extremes are kept within 1-99', [g.percentile('weight', 'm', 3, 2), g.percentile('weight', 'm', 3, 12)], [1, 99])
  equal('age in months', Math.round(g.ageMonths('2026-01-15', '2026-07-15') * 100) / 100, 5.95)
  check('source recorded', g.SOURCE.url.includes('cdc.gov') && /^\d{4}-\d{2}-\d{2}$/.test(g.SOURCE.retrieved))
}
