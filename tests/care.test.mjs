// Diapers and sleep tabs: logging, counts, undo, past days, per baby, stats/report, and sync to the other phone.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { memoryStore } from './lib/memory-store.mjs'

export async function run(DIST) {
  suite('Diapers and sleep')
  const store = memoryStore()
  const srv = await serve(DIST, 8765, store)
  const profiles = { A: mkdtempSync(join(tmpdir(), 'mt-care-a-')), B: mkdtempSync(join(tmpdir(), 'mt-care-b-')) }
  let b = null
  const open = async (phone) => {
    b = await launch({ profile: profiles[phone] })
    await b.goto(srv.url)
    if (!(await b.ev('localStorage.getItem("suivi-lait-lang-v1")'))) { await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload() }
  }
  const close = async () => { equal('no JS errors', b.errors.filter((e) => !/Failed to fetch|ERR_|net::/.test(e)), []); await b.close(); b = null }
  const rows = (list) => b.ev(`[...document.querySelectorAll("#${list} .feed-item .amt")].map(e=>e.textContent.trim()).join(",")`)
  const syncAndWait = async () => {
    if (!(await b.exists('#settings'))) await b.click('#settings-btn')
    const before = await b.ev(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync||""`)
    await sleep(5); await b.click('#share-now')
    await b.waitFor(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync > ${JSON.stringify(before)}`, 8000)
    await sleep(400)
    await b.click('#settings-close')
  }
  try {
    await open('A')
    await b.click('#quick-grid button', 3) // stats need at least one bottle in the period
    await b.tab('diapers')
    equal('empty day', await b.text('#diaper-total'), '0')
    for (const k of ['wet', 'dirty', 'both']) { await b.click('#diaper-' + k); await sleep(150) }
    equal('three diapers: 2 wet, 2 dirty ("both" counts twice)', [await b.text('#diaper-total'), await b.text('.care-detail')], ['3', '2 pipi · 2 caca'])
    equal('newest first', await rows('diaper-list'), '💧💩 Les deux,💩 Caca,💧 Pipi')
    await b.click('#diaper-list .del', 0)
    await b.waitFor(`document.querySelectorAll("#diaper-list .feed-item").length===2`)
    equal('delete offers undo', await b.text('#toast .toast-text'), 'Couche supprimée')
    await b.click('#toast-undo')
    await b.waitFor(`document.querySelectorAll("#diaper-list .feed-item").length===3`)
    check('undo restores it', true)

    await b.click('#prev-day')
    check('past day: time field shown', await b.exists('#diaper-time'))
    await b.setValue('#diaper-time', '06:45')
    await b.click('#diaper-wet'); await sleep(150)
    equal('past-day diaper at the chosen time', await b.ev(`document.querySelector("#diaper-list .time").textContent`), '06:45')
    await b.click('#next-day')

    await b.tab('stats')
    equal('stats: diapers per day (over days with diapers)', await b.ev(`[...document.querySelectorAll(".stat")].map(e=>e.textContent).find(s=>s.indexOf("couches")>=0)`), '2couches / jour')
    await b.click('#report-btn'); await sleep(200)
    check('report has a diapers column', (await b.ev(`[...document.querySelectorAll("#report-table thead th")].map(e=>e.textContent).join("|")`)).includes('Couches'))
    await b.click('#report-close')

    // a second baby has its own diapers
    await b.click('#settings-btn'); await b.click('#add-baby'); await b.click('#settings-close')
    await b.tab('diapers')
    equal('second baby: no diapers yet', await b.text('#diaper-total'), '0')
    await b.click('#diaper-dirty'); await sleep(150)
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[0].value')); await sleep(200)
    equal('first baby unchanged', await b.text('#diaper-total'), '3')

    // sync: B joins and sees both babies' diapers
    await b.click('#settings-btn'); await b.click('#share-create')
    await b.waitFor(`!!document.getElementById("share-code")`)
    const code = await b.text('#share-code')
    await b.click('#settings-close')
    await syncAndWait()
    await close()

    await open('B')
    await b.click('#settings-btn')
    await b.setValue('#share-code-input', code); await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    await b.click('#settings-close')
    await syncAndWait()
    await b.tab('diapers')
    equal("B: first baby's diapers synced", await b.text('#diaper-total'), '3')
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[1].value')); await sleep(200)
    equal("B: second baby's diaper synced", await rows('diaper-list'), '💩 Caca')
    await close()
  } finally {
    if (b) await b.close()
    await srv.stop()
    for (const d of Object.values(profiles)) rmSync(d, { recursive: true, force: true })
  }
}
