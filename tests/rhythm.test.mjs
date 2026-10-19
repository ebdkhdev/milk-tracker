// Feeding rhythm: average interval and expected next bottle, from feeds imported at known offsets.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes())
const day = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

export async function run(DIST) {
  suite('Rhythm: interval between bottles')
  const srv = await serve(DIST)
  const b = await launch()
  const dir = mkdtempSync(join(tmpdir(), 'milk-tracker-rhythm-'))
  // replaces every feed with bottles taken `offsets` minutes ago
  const seed = async (offsets) => {
    const t0 = Date.now()
    await b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var tx=r.result.transaction(["feeds"],"readwrite");tx.objectStore("feeds").clear();tx.oncomplete=function(){r.result.close();res(1)}}})`)
    const feeds = offsets.map((m, i) => { const d = new Date(t0 - m * 60000); return { id: 'r' + i, date: day(d), ml: 100, time: d.toISOString() } })
    const file = join(dir, 'r.json')
    writeFileSync(file, JSON.stringify({ app: 'milk-tracker', version: 1, feeds, daily: [] }))
    await b.setFiles('#import-file', [file])
    await sleep(500)
    return t0
  }
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    await b.click('#settings-btn')

    let t0 = await seed([600, 420, 240, 60])
    equal('every 3 h, next = last + 3 h', await b.text('#rhythm'), `Toutes les 3 h en moyenne · prochain vers ${hhmm(new Date(t0 + 120 * 60000))}`)
    equal('interval tile', await b.ev(`[...document.querySelectorAll(".stat")].map(e=>e.textContent).find(s=>s.indexOf("entre deux")>=0)`), '3:00hentre deux biberons')

    t0 = await seed([700, 500, 300, 200])
    equal('overdue wording', await b.text('#rhythm'), `Toutes les 2 h 47 min en moyenne · prochain attendu depuis ${hhmm(new Date(t0 - 200 * 60000 + (500 / 3) * 60000))}`)

    // a 10 h gap (unlogged night) and a 5 min top-up are left out: intervals 100, 100, 100
    t0 = await seed([1000, 400, 300, 200, 195, 95])
    check('long gaps and top-ups excluded', (await b.text('#rhythm')).startsWith('Toutes les 1 h 40 min en moyenne'), await b.text('#rhythm'))

    await seed([300, 200])
    check('hidden with too few bottles', !(await b.exists('#rhythm')))
    await seed([1700, 1600, 1500, 1450])
    check('hidden 24 h after the last bottle', !(await b.exists('#rhythm')))
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
