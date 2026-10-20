// Downloads the WHO Child Growth Standards tables (0-24 months, as published by the CDC) and writes:
//   src/lib/who-growth.json      L, M, S per month, by measure and sex (what the app uses)
//   tests/fixtures/who-check.json  the tables' own percentile columns, to test the LMS formula against
// Run with: node scripts/who-import.mjs  (only needed if the source tables change)
import { writeFileSync } from 'node:fs'

const SOURCE = 'https://www.cdc.gov/growthcharts/who-data-files.htm'
const BASE = 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/'
const FILES = {
  weight: { m: 'WHO-Boys-Weight-for-age-Percentiles.csv', f: 'WHO-Girls-Weight-for-age%20Percentiles.csv' },
  length: { m: 'WHO-Boys-Length-for-age-Percentiles.csv', f: 'WHO-Girls-Length-for-age-Percentiles.csv' },
  head: { m: 'WHO-Boys-Head-Circumference-for-age-Percentiles.csv', f: 'WHO-Girls-Head-Circumference-for-age-Percentiles.csv' },
}

const lms = {}, check = {}
for (const [measure, bySex] of Object.entries(FILES)) {
  lms[measure] = {}
  check[measure] = {}
  for (const [sex, file] of Object.entries(bySex)) {
    const res = await fetch(BASE + file)
    if (!res.ok) throw new Error(file + ': ' + res.status)
    const rows = (await res.text()).replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','))
    const head = rows.shift()
    // exact names for the one-letter columns ("M" must not match "Month"), prefixes for the percentiles
    const exact = (name) => head.findIndex((h) => h.trim() === name)
    const prefix = (name) => head.findIndex((h) => h.trim().startsWith(name))
    const [iM, iL, iMu, iS, iLo, i50, iHi] = [exact('Month'), exact('L'), exact('M'), exact('S'), prefix('2nd'), prefix('50th'), prefix('98th')]
    if ([iM, iL, iMu, iS, iLo, i50, iHi].some((i) => i < 0)) throw new Error(file + ': unexpected columns ' + head.join('|'))
    const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(file + ': not a number ' + v); return n }
    if (rows.length !== 25 || rows.some((r, i) => num(r[iM]) !== i)) throw new Error(file + ': expected months 0..24')
    lms[measure][sex] = rows.map((r) => [num(r[iL]), num(r[iMu]), num(r[iS])])
    check[measure][sex] = rows.map((r) => [num(r[iLo]), num(r[i50]), num(r[iHi])]) // P2.3 (z = -2), P50, P97.7 (z = +2)
  }
}
const meta = { source: SOURCE, files: BASE, retrieved: new Date().toISOString().slice(0, 10), units: { weight: 'kg', length: 'cm', head: 'cm' }, ages: 'completed months 0-24' }
writeFileSync(new URL('../src/lib/who-growth.json', import.meta.url), JSON.stringify({ ...meta, lms }) + '\n')
writeFileSync(new URL('../tests/fixtures/who-check.json', import.meta.url), JSON.stringify({ ...meta, columns: ['P2.3', 'P50', 'P97.7'], check }) + '\n')
console.log('written: 3 measures x 2 sexes x 25 months')
