// Growth tab: measurements, validation, percentiles against the WHO maths, chart, undo, report line.
import { ageMonths, percentile } from '../src/lib/growth.ts'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

const pad = (n) => String(n).padStart(2, '0')
const day = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

export async function run(DIST) {
  suite('Growth tab')
  const srv = await serve(DIST)
  const b = await launch()
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`); await b.reload()
    await b.click('#quick-grid button', 3)
    await b.tab('growth')
    check('without birth date and sex: explanation instead of curves', (await b.exists('#growth-no-curves')) && !(await b.exists('#growth-chart')))
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }) // headless windows are not focused
    await b.ev('document.getElementById("growth-in-weight").focus()'); await sleep(100)
    equal('tab bar hidden while typing', await b.ev('getComputedStyle(document.querySelector(".tabbar")).display'), 'none')
    await b.ev('document.getElementById("growth-in-weight").blur()'); await sleep(100)
    equal('and back after', await b.ev('getComputedStyle(document.querySelector(".tabbar")).display'), 'flex')
    await b.setValue('#growth-in-weight', '3500')
    await b.click('#growth-add')
    equal('grams typed as kilograms are refused', await b.text('#growth-error'), 'Poids semble improbable : vérifie l’unité (entre 0.5 et 30).'.replace('’', "'"))
    await b.setValue('#growth-in-weight', '6,2')
    await b.setValue('#growth-in-length', '62')
    await b.setValue('#growth-in-head', '40')
    await b.click('#growth-add'); await sleep(200)
    equal('measurement listed (no percentile yet)', await b.ev(`[...document.querySelectorAll("#growth-list .growth-value")].map(e=>e.textContent).join(" | ")`), '6,2 kg | 62 cm | 40 cm')

    const birth = new Date(); birth.setMonth(birth.getMonth() - 4)
    const bd = day(birth), today = day(new Date())
    await b.click('#settings-btn')
    await b.setValue('#birth-date', bd); await b.click('#sex-f')
    await b.click('#settings-close')
    await b.tab('growth')
    const age = ageMonths(bd, today)
    const expected = [['weight', 6.2, 'kg'], ['length', 62, 'cm'], ['head', 40, 'cm']].map(([m, v]) => percentile(m, 'f', age, v))
    equal('percentiles shown, as computed from the WHO tables', await b.ev(`[...document.querySelectorAll("#growth-list .growth-value")].map(e=>e.textContent).join(" | ")`), `6,2 kg · P${expected[0]} | 62 cm · P${expected[1]} | 40 cm · P${expected[2]}`)
    equal('chart: 5 WHO curves and the baby\'s point', [await b.count('#growth-chart .curve'), await b.count('#growth-chart .baby-point')], [5, 1])
    await b.click('#growth-length'); await sleep(100)
    check('switching to length', (await b.ev('document.getElementById("growth-chart").getAttribute("aria-label")')).startsWith('Courbe de Taille'))
    await b.click('#growth-list .del', 0)
    await b.waitFor(`!document.querySelector("#growth-list .feed-item")`)
    await b.click('#toast-undo')
    await b.waitFor(`!!document.querySelector("#growth-list .feed-item")`)
    check('delete then undo', true)

    await b.tab('stats')
    await b.click('#report-btn'); await sleep(200)
    check('report: latest measurement with percentile', (await b.text('#report-summary')).includes(`6,2 kg (P${expected[0]})`))
    await b.click('#report-close')
    await b.setValue('#lang-select', 'ar'); await b.tab('growth')
    equal('chart stays left-to-right in Arabic', await b.ev('getComputedStyle(document.querySelector(".growth-chart")).direction'), 'ltr')
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
  }
}
