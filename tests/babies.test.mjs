// Several babies: separate days, vitamin D, minimum and stats; selector only with two or more; backup;
// removal. Then two phones in a family, one of them still on v2.8.0 (before babies existed), and the
// IndexedDB upgrade from v3 (v2.8.0) with changes waiting to be sent.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { memoryStore } from './lib/memory-store.mjs'
import { buildTag } from './lib/oldbuild.mjs'

const idb = (store) => `new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var q=r.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll();q.onsuccess=function(){r.result.close();res(q.result)}}})`

export async function run(DIST) {
  suite('Several babies')
  const store = memoryStore()
  const srv = await serve(DIST, 8765, store)
  const dir = mkdtempSync(join(tmpdir(), 'mt-babies-'))
  const profiles = { A: mkdtempSync(join(tmpdir(), 'mt-bb-a-')), B: mkdtempSync(join(tmpdir(), 'mt-bb-b-')) }
  let b = null
  const open = async (phone, url = srv.url) => {
    b = await launch({ profile: phone ? profiles[phone] : undefined })
    await b.send('Page.navigate', { url })
    await b.waitFor(`!!document.querySelector("#quick-grid button")`, 15000)
    if (!(await b.ev('localStorage.getItem("suivi-lait-lang-v1")'))) { await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.send('Page.reload'); await sleep(300); await b.waitFor(`!!document.querySelector("#quick-grid button")`, 15000) }
  }
  const close = async () => { equal('no JS errors', b.errors.filter((e) => !/Failed to fetch|ERR_|net::/.test(e)), []); await b.close(); b = null }
  const openSettings = async () => { if (!(await b.exists('#settings'))) await b.click('#settings-btn') }
  const total = () => b.text('#total-number')
  const amounts = () => b.ev(`[...document.querySelectorAll(".feed-item .amt")].map(e=>e.textContent).sort().join(",")`)
  const syncAndWait = async () => {
    await openSettings()
    const before = await b.ev(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync||""`)
    await sleep(5)
    await b.click('#share-now')
    await b.waitFor(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync > ${JSON.stringify(before)}`, 8000)
    await sleep(400)
  }

  try {
    // ---- one phone ----
    await open('A')
    await b.click('#quick-grid button', 3); await sleep(150) // 150 ml for the first baby
    await openSettings()
    check('one baby: no selector, name in the bar', !(await b.exists('#baby-select')) && (await b.text('.brand-name')) === 'Milk Tracker')
    await b.type('#baby-name', 'Léa')
    await b.click('#sex-f')
    await b.click('#add-baby')
    await b.waitFor(`!!document.getElementById("baby-select")`)
    equal('second baby added and selected', [await b.ev('[...document.querySelectorAll("#baby-select option")].map(o=>o.textContent).join(",")'), await b.ev('document.getElementById("baby-select").value === document.querySelectorAll("#baby-select option")[1].value')], ['Léa,Bébé 2', true])
    equal('new baby starts empty', await total(), '0')
    await b.type('#baby-name', 'Noé')
    await b.click('#sex-m')
    await b.setValue('#birth-date', '2026-01-10'); await sleep(100)
    await b.click('#settings-close')
    for (const i of [0, 1]) { await b.click('#quick-grid button', i); await sleep(150) } // 60 + 90 for Noé
    await b.click('#vitd-btn'); await sleep(150)
    equal('Noé: his own bottles and total', [await amounts(), await total()], ['60 ml,90 ml', '150'])
    check('Noé: minimum from his own age', (await b.text('#goal-target')).startsWith('min. 700 ml'))
    await b.setValue('#baby-select', (await b.ev('document.querySelectorAll("#baby-select option")[0].value'))); await sleep(200)
    equal('Léa: hers only, vitamin D not given', [await amounts(), await total(), await b.ev('document.getElementById("vitd-btn").getAttribute("aria-pressed")')], ['150 ml', '150', 'false'])
    await b.tab('stats')
    equal('Léa: stats count only hers', await b.ev(`document.querySelector(".history-row .hval").textContent`), '150 ml')
    await b.tab('feeds')
    await b.send('Page.reload'); await sleep(300); await b.waitFor(`!!document.getElementById("baby-select")`)
    equal('selection kept after reload', await b.ev('document.getElementById("baby-select").selectedOptions[0].textContent'), 'Léa')
    const feeds = await b.ev(idb('feeds'))
    equal('first baby records unchanged (no babyId), twin tagged', feeds.map((f) => [f.ml, f.babyId || null]).sort(), [[150, null], [60, feeds.find((f) => f.ml === 60).babyId], [90, feeds.find((f) => f.ml === 90).babyId]].sort())
    check('twin has its own id', !!feeds.find((f) => f.ml === 60).babyId)

    // backup round trip keeps both babies
    await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
    await openSettings()
    await b.click('#export-btn')
    let file
    for (let i = 0; i < 50 && !file; i++) { await sleep(100); file = readdirSync(dir).find((f) => f.endsWith('.json')) }
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    equal('backup has both babies and the twin\'s vitamin D', [data.profiles.map((p) => p.name).join(','), data.days.length, data.feeds.filter((f) => f.babyId).length], ['Léa,Noé', 1, 2])
    await close()

    await open(null)
    await openSettings()
    await b.setFiles('#import-file', [join(dir, file)])
    await b.waitFor(`!!document.getElementById("baby-select")`)
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[1].value')); await sleep(200)
    equal('restored on a new phone: Noé with his bottles', [await b.ev('document.getElementById("baby-select").selectedOptions[0].textContent'), await amounts()], ['Noé', '60 ml,90 ml'])
    await close()

    // ---- two phones: A (new) creates the family, B (new) joins and sees both babies ----
    await open('A')
    await openSettings()
    await b.click('#share-create')
    await b.waitFor(`!!document.getElementById("share-code")`)
    const code = await b.text('#share-code')
    await syncAndWait()
    await close()

    await open('B')
    await openSettings()
    await b.setValue('#share-code-input', code)
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    await syncAndWait()
    await b.waitFor(`!!document.getElementById("baby-select")`)
    equal('B: both babies with their names', await b.ev('[...document.querySelectorAll("#baby-select option")].map(o=>o.textContent).join(",")'), 'Léa,Noé')
    await b.setValue('#baby-select', await b.ev('[...document.querySelectorAll("#baby-select option")].find(o=>o.textContent==="Noé").value')); await sleep(200)
    equal('B: Noé\'s bottles and vitamin D', [await amounts(), await b.ev('document.getElementById("vitd-btn").getAttribute("aria-pressed")')], ['60 ml,90 ml', 'true'])
    await close()

    // ---- a phone still on v2.8.0 joins the same family ----
    const OLD = buildTag('v2.8.0')
    srv.setDir(OLD)
    const old = mkdtempSync(join(tmpdir(), 'mt-bb-old-'))
    b = await launch({ profile: old })
    await b.goto(srv.url)
    await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload()
    await b.click('#settings-btn')
    await b.setValue('#share-code-input', code)
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    await b.click('#share-now'); await sleep(2500)
    equal('v2.8.0 phone: only the first baby\'s bottles (twin ignored)', [await amounts(), await total()], ['150 ml', '150'])
    // the old phone edits the shared baby settings (it knows nothing of names)
    await b.setValue('#birth-date', '2026-02-02'); await sleep(200)
    await b.click('#share-now'); await sleep(2500)
    equal('v2.8.0 phone: no JS errors', b.errors.filter((e) => !/Failed to fetch|ERR_|net::/.test(e)), [])
    await b.close(); b = null
    srv.setDir(DIST)

    await open('A')
    await syncAndWait()
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[0].value')); await sleep(200)
    await openSettings()
    equal('A: old phone\'s birth date applied, name and sex kept', [await b.ev('document.getElementById("birth-date").value'), await b.ev('document.getElementById("baby-name").value'), await b.ev('document.getElementById("sex-f").getAttribute("aria-pressed")')], ['2026-02-02', 'Léa', 'true'])

    // removing Noé deletes his records here and on B
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[1].value')); await sleep(200)
    await openSettings()
    await b.click('#remove-baby')
    await b.click('#remove-baby-yes')
    await b.waitFor(`!document.getElementById("baby-select")`)
    equal('A: back to one baby, Léa\'s data intact', [await amounts(), (await b.ev(idb('feeds'))).length, (await b.ev(idb('days'))).length], ['150 ml', 1, 0])
    await syncAndWait()
    await close()
    await open('B')
    await syncAndWait()
    check('B: Noé removed too', !(await b.exists('#baby-select')) && (await b.ev(idb('feeds'))).length === 1)
    await close()
    rmSync(old, { recursive: true, force: true })

    // ---- IndexedDB upgrade v3 -> v4 with changes waiting in the outbox ----
    srv.setDir(OLD)
    const up = mkdtempSync(join(tmpdir(), 'mt-bb-up-'))
    b = await launch({ profile: up })
    await b.goto(srv.url)
    await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload()
    await b.click('#settings-btn')
    await b.setValue('#share-code-input', code)
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    await b.click('#share-now'); await sleep(2500)
    store.down = true
    await b.click('#quick-grid button', 0); await sleep(300) // queued, can't be sent
    const queued = (await b.ev(idb('outbox'))).length
    await b.close(); b = null
    store.down = false
    srv.setDir(DIST)
    b = await launch({ profile: up })
    await b.send('Page.navigate', { url: srv.url }); await sleep(2000)
    for (let i = 0; i < 2; i++) { await b.send('Page.reload'); await sleep(2000) } // let the new service worker take over
    await b.waitFor(`!!document.getElementById("total-number")`, 15000)
    const v = await b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var d=r.result;res([d.version,[].slice.call(d.objectStoreNames).sort().join(",")]);d.close()}})`)
    equal('database upgraded to v4 with the new stores', v, [4, 'daily,days,events,feeds,outbox'])
    check(`queued change kept through the upgrade (${queued} queued)`, queued > 0)
    await b.waitFor(`(document.getElementById("total-number")||{}).textContent==="210"`, 8000).catch(() => {})
    equal('data kept: 150 + 60', await total(), '210')
    await b.waitFor(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var q=r.result.transaction("outbox").objectStore("outbox").count();q.onsuccess=function(){r.result.close();res(q.result===0)}}})`, 10000)
    check('and sent once back online', true)
    await close()
    rmSync(up, { recursive: true, force: true })
  } finally {
    if (b) await b.close()
    srv.setDir(DIST)
    await srv.stop()
    for (const d of [dir, profiles.A, profiles.B]) rmSync(d, { recursive: true, force: true })
  }
}
