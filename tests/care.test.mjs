// Diapers and sleep tabs: logging, counts, undo, past days, per baby, stats/report, and sync to the other phone.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { fakeAuth } from './lib/fakeauth.mjs'
import { signUp } from './lib/family.mjs'
import { memoryAccountStore, memoryStore } from './lib/memory-store.mjs'

export async function run(DIST) {
  suite('Diapers and sleep')
  const store = memoryStore()
  const accounts = memoryAccountStore(store)
  const auth = await fakeAuth(accounts)
  store.account = { store: accounts, keys: auth.keys }
  store.fakeAuth = auth
  const srv = await serve(DIST, 8765, store)
  const profiles = { A: mkdtempSync(join(tmpdir(), 'mt-care-a-')), B: mkdtempSync(join(tmpdir(), 'mt-care-b-')) }
  let b = null
  const open = async (phone) => {
    b = await launch({ profile: profiles[phone], fakeAuth: true })
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

    // ---- sleep ----
    await b.tab('sleep')
    equal('no sleep yet', await b.text('#sleep-total'), '0 min')
    await b.click('#sleep-start'); await sleep(200)
    check('sleep running', (await b.exists('#sleep-running')) && (await b.exists('#sleep-stop')))
    await b.click('#sleep-stop'); await sleep(200)
    equal('stopped: listed', await b.count('#sleep-list .feed-item'), 1)
    // a night across midnight, entered on yesterday: 2 h yesterday, 6 h 30 today
    await b.click('#prev-day')
    await b.setValue('#sleep-from', '22:00'); await b.setValue('#sleep-to', '06:30')
    await b.click('#sleep-add'); await sleep(200)
    equal('yesterday: 2 h of that night', await b.text('#sleep-total'), '2 h')
    await b.setValue('#sleep-from', '10:00'); await b.setValue('#sleep-to', '10:00')
    await b.click('#sleep-add'); await sleep(100)
    check('24 h or more is refused', (await b.text('.sleep-add .share-error')).startsWith('La fin doit'))
    await b.click('#next-day')
    check('today: the night\'s 6 h 30 (plus the short one)', (await b.text('#sleep-total')).startsWith('6 h 3'))
    equal('the night shows on both days', await b.ev(`document.querySelector("#sleep-list .amt").textContent`), '22:00 → 06:30')
    // a sleep started 13 h ago: the wake-up was probably forgotten
    await b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var tx=r.result.transaction("events","readwrite");var t=new Date(Date.now()-13*3600e3);tx.objectStore("events").put({id:"long-1",type:"sleep",time:t.toISOString(),end:null,date:t.toISOString().slice(0,10),updatedAt:1});tx.oncomplete=function(){r.result.close();res(1)}}})`)
    await b.reload(); await b.tab('sleep')
    check('long sleep: asks about the wake-up', await b.exists('#sleep-long'))
    // a wake-up in the future (13 h after a start 13 h ago would be "now + 0"; take start + 13 h 30) is refused
    const future = await b.ev(`(function(){var d=new Date(Date.now()+30*60e3);return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")})()`)
    await b.setValue('#sleep-wake', future)
    await b.click('#sleep-fix'); await sleep(150)
    check('a wake-up in the future is refused, the sleep keeps running', (await b.exists('#sleep-wake-error')) && (await b.exists('#sleep-running')))
    const wake = await b.ev(`(function(){var d=new Date(Date.now()-11*3600e3);return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")})()`)
    await b.setValue('#sleep-wake', wake)
    await b.click('#sleep-fix'); await sleep(200)
    const fixed = (await b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var q=r.result.transaction("events").objectStore("events").get("long-1");q.onsuccess=function(){r.result.close();res(q.result)}}})`))
    check('corrected wake-up: a 2 h sleep', Math.abs(Date.parse(fixed.end) - Date.parse(fixed.time) - 2 * 3600e3) < 120e3, JSON.stringify(fixed))
    await b.tab('stats')
    check('stats: sleep per day', !!(await b.ev(`[...document.querySelectorAll(".stat")].map(e=>e.textContent).find(s=>s.indexOf("sommeil")>=0)`)))
    await b.tab('feeds')

    // a second baby has its own diapers
    await b.click('#settings-btn'); await b.click('#add-baby'); await b.click('#settings-close')
    await b.tab('diapers')
    equal('second baby: no diapers yet', await b.text('#diaper-total'), '0')
    await b.click('#diaper-dirty'); await sleep(150)
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[0].value')); await sleep(200)
    equal('first baby unchanged', await b.text('#diaper-total'), '3')

    // sync: A signs up; B (another device of the same account) sees both babies' diapers
    await signUp(b, 'parent@example.com', 'Parent')
    await b.click('#settings-close')
    await syncAndWait()
    await close()

    await open('B')
    await signUp(b, 'parent@example.com', '', true)
    await b.click('#settings-close')
    await syncAndWait()
    await b.tab('diapers')
    equal("B: first baby's diapers synced", await b.text('#diaper-total'), '3')
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[1].value')); await sleep(200)
    equal("B: second baby's diaper synced", await rows('diaper-list'), '💩 Caca')
    await close()

    // a sleep started on A is seen running on B, which ends it
    await open('A')
    await b.tab('sleep')
    await b.click('#sleep-start'); await sleep(200)
    await syncAndWait()
    await close()
    await open('B')
    await syncAndWait()
    await b.setValue('#baby-select', await b.ev('document.querySelectorAll("#baby-select option")[0].value')); await sleep(200)
    await b.tab('sleep')
    check('B: the sleep started on A is running here', await b.exists('#sleep-running'))
    await b.click('#sleep-stop'); await sleep(200)
    await syncAndWait()
    await close()
    await open('A')
    await syncAndWait()
    await b.tab('sleep')
    check('A: ended on B', (await b.exists('#sleep-start')) && !(await b.exists('#sleep-running')))
    await close()
  } finally {
    if (b) await b.close()
    await srv.stop()
    for (const d of Object.values(profiles)) rmSync(d, { recursive: true, force: true })
  }
}
