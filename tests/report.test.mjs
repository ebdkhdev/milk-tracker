// Paediatrician report: same figures as the stats, notes, print layout (light, no app chrome), focus, RTL.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

const pad = (n) => String(n).padStart(2, '0')
const day = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

export async function run(DIST) {
  suite('Report for the paediatrician')
  const srv = await serve(DIST)
  const b = await launch()
  const dir = mkdtempSync(join(tmpdir(), 'milk-tracker-report-'))
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    // three days of bottles, a note, vitamin D on one day
    const feeds = [], daily = []
    for (let d = 1; d <= 3; d++) {
      const base = new Date(); base.setDate(base.getDate() - d); base.setHours(8, 0, 0, 0)
      for (let i = 0; i < 4; i++) {
        const t = new Date(base.getTime() + i * 3 * 3600 * 1000)
        feeds.push({ id: `d${d}-${i}`, date: day(t), ml: 150 + d * 10, time: t.toISOString(), ...(d === 1 && i === 2 ? { note: 'régurgitation' } : {}) })
      }
      if (d === 2) daily.push({ date: day(base), vitaminD: true, vitaminDTime: base.toISOString() })
    }
    const file = join(dir, 'r.json')
    writeFileSync(file, JSON.stringify({ app: 'milk-tracker', version: 1, feeds, daily }))
    await b.click('#settings-btn')
    await b.setFiles('#import-file', [file]); await sleep(500)
    await b.click('#settings-close')

    await b.tab('stats')
    const tiles = await b.ev(`Object.fromEntries([...document.querySelectorAll(".stat")].map(e=>[e.querySelector(".sl").textContent, e.querySelector(".sv").textContent]))`)
    await b.click('#report-btn'); await sleep(300)
    check('report replaces the main view', (await b.exists('#report')) && !(await b.exists('#total-number')))
    equal('focus on the report title', await b.ev('document.activeElement.id'), 'report-title')
    const summary = await b.ev(`Object.fromEntries([...document.querySelectorAll("#report-summary div")].map(e=>[e.querySelector("dt").textContent, e.querySelector("dd").textContent]))`)
    equal('same figures as the stats', [summary['moyenne / jour'], summary['biberons / jour'], summary['jours vitamine D'], summary['entre deux biberons']],
      [tiles['moyenne / jour'].replace('ml', ' ml'), tiles['biberons / jour'], tiles['jours vitamine D'], tiles['entre deux biberons'].replace('h', ' h')])
    equal('one row per day (7 days)', await b.count('#report-table tbody tr'), 7)
    check('note listed', (await b.text('.report-notes')).includes('régurgitation'))
    await b.click('#report-period-30'); await sleep(200)
    equal('30 days', await b.count('#report-table tbody tr'), 30)
    await b.click('#report-period-7'); await sleep(200)

    // print in dark mode: report only, on white, no backdrop or glass
    await b.send('Emulation.setEmulatedMedia', { media: 'print', features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    const printed = await b.ev(`({ header: getComputedStyle(document.querySelector("header")).display,
      backdrop: getComputedStyle(document.body, "::before").display,
      actions: getComputedStyle(document.querySelector(".report-actions")).display,
      sheet: getComputedStyle(document.querySelector(".report-sheet")).backgroundColor,
      title: getComputedStyle(document.getElementById("report-title")).color })`)
    equal('print: report only, black on white (even in dark mode)', printed, { header: 'none', backdrop: 'none', actions: 'none', sheet: 'rgb(255, 255, 255)', title: 'rgb(0, 0, 0)' })
    const pdf = Buffer.from((await b.send('Page.printToPDF', { printBackground: true })).data, 'base64').toString('latin1')
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length
    check(`7-day report prints on one page (${pages})`, pages === 1)
    await b.send('Emulation.setEmulatedMedia', { media: '', features: [] })

    await b.click('#report-close'); await sleep(300)
    check('back to the stats view', (await b.exists('#report-btn')) && !(await b.exists('#report')))
    equal('focus back on the report button', await b.ev('document.activeElement.id'), 'report-btn')

    await b.setValue('#lang-select', 'ar')
    await b.tab('stats')
    await b.click('#report-btn'); await sleep(200)
    for (const [w, pct] of [[320, 100], [390, 200]]) {
      await b.viewport(w, 700)
      await b.ev(`document.documentElement.style.fontSize="${pct * 1.0625}%"`); await sleep(200)
      equal(`Arabic ${w}px at ${pct}%: no horizontal scroll`, await b.ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true)
    }
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
