// Settings panel: editable quick-add amounts (with suggestion from usual amounts and defaults).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

export async function run(DIST) {
  suite('Settings: quick-add amounts')
  const srv = await serve(DIST)
  const b = await launch()
  const dir = mkdtempSync(join(tmpdir(), 'milk-tracker-settings-'))
  const buttons = () => b.ev(`[...document.querySelectorAll("#quick-grid button")].map(e=>e.textContent).join(",")`)
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    equal('default buttons', await buttons(), '60 ml,90 ml,120 ml,150 ml')
    await b.click('#settings-btn')
    equal('panel title', await b.text('.settings-title'), 'Réglages')
    check('no reset button with defaults', !(await b.exists('#quick-reset')))

    await b.type('#quick-edit input', '180', 1)
    await sleep(200)
    equal('edited button', await buttons(), '60 ml,180 ml,120 ml,150 ml')
    await b.click('#quick-grid button', 1)
    await b.waitFor(`document.getElementById("total-number").textContent==="180"`)
    check('edited button adds its amount', true)
    await b.click('#unit-oz'); await sleep(100)
    await b.ev(`(function(){var e=document.querySelectorAll("#quick-edit input")[1];e.focus();e.blur()})()`)
    await b.click('#unit-ml'); await sleep(100)
    equal('oz focus/blur does not shift the ml value', await buttons(), '60 ml,180 ml,120 ml,150 ml')
    await b.reload()
    equal('persists after reload', await buttons(), '60 ml,180 ml,120 ml,150 ml')

    // usual amounts of the last 14 days: 100 twice, then 130, 170 (and 180 from above)
    for (const v of ['100', '100', '130', '170']) { await b.setValue('#custom-amount', v); await b.click('#custom-add'); await sleep(150) }
    await b.click('#settings-btn')
    await b.waitFor(`!!document.getElementById("quick-suggest")`)
    equal('suggestion from usual amounts', await b.text('#quick-suggest'), 'Mes quantités habituelles : 100 · 130 · 170 · 180')
    await b.click('#quick-suggest'); await sleep(200)
    equal('suggestion applied', await buttons(), '100 ml,130 ml,170 ml,180 ml')
    check('suggestion hidden once applied', !(await b.exists('#quick-suggest')))
    await b.click('#quick-reset'); await sleep(200)
    equal('reset to defaults', await buttons(), '60 ml,90 ml,120 ml,150 ml')

    // import: a device still on defaults takes the file's amounts; customised ones are kept
    const file = join(dir, 'b.json')
    writeFileSync(file, JSON.stringify({ app: 'milk-tracker', version: 1, feeds: [], daily: [], quick: [80, 110, 140, 170] }))
    await b.setFiles('#import-file', [file]); await sleep(400)
    equal('defaults take the file amounts', await buttons(), '80 ml,110 ml,140 ml,170 ml')
    writeFileSync(file, JSON.stringify({ app: 'milk-tracker', version: 1, feeds: [], daily: [], quick: [10, 20, 30, 40] }))
    await b.setFiles('#import-file', [file]); await sleep(400)
    equal('customised amounts are kept', await buttons(), '80 ml,110 ml,140 ml,170 ml')
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
