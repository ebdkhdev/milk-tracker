// Family sharing between two phones (two Chrome profiles, one after the other) through an in-memory server
// running the real protocol code: merge, deletion, undo, conflict, offline queue, baby settings, leaving.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { memoryStore } from './lib/memory-store.mjs'

export async function run(DIST) {
  suite('Sharing between parents')
  const store = memoryStore()
  const srv = await serve(DIST, 8765, store)
  const profiles = { A: mkdtempSync(join(tmpdir(), 'mt-phone-a-')), B: mkdtempSync(join(tmpdir(), 'mt-phone-b-')) }
  let b = null
  const open = async (phone) => {
    b = await launch({ profile: profiles[phone] })
    await b.goto(srv.url)
    if (!(await b.ev('localStorage.getItem("suivi-lait-lang-v1")'))) { await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload() }
  }
  const close = async () => { equal('no JS errors', b.errors.filter((e) => !/Failed to fetch|ERR_|net::/.test(e)), []); await b.close(); b = null }
  const amounts = () => b.ev(`[...document.querySelectorAll(".feed-item .amt")].map(e=>e.textContent).sort().join(",")`)
  const openSettings = async () => { if (!(await b.exists('#settings'))) await b.click('#settings-btn') }
  const outboxSize = () => b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var q=r.result.transaction("outbox").objectStore("outbox").count();q.onsuccess=function(){r.result.close();res(q.result)}}})`)
  // forces a sync and waits until the outbox is empty and the sync time has moved
  const syncAndWait = async () => {
    await openSettings()
    const before = await b.ev(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync||""`)
    await sleep(5)
    await b.click('#share-now')
    await b.waitFor(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync > ${JSON.stringify(before)}`, 8000)
    await b.waitFor(`document.getElementById("share-status") && document.getElementById("share-status").textContent.indexOf("Synchronisé") === 0`)
    await sleep(300) // let the UI reload the day after applying remote changes
    return (await outboxSize()) === 0
  }
  // a daily record written as the app did before sharing existed (no updatedAt)
  const putOldDaily = (date, given) => b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var tx=r.result.transaction("daily","readwrite");tx.objectStore("daily").put({date:${JSON.stringify(date)},vitaminD:${given},vitaminDTime:${given ? '"2026-01-01T08:00:00.000Z"' : 'null'}});tx.oncomplete=function(){r.result.close();res(1)}}})`)
  const getDaily = (date) => b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var q=r.result.transaction("daily").objectStore("daily").get(${JSON.stringify(date)});q.onsuccess=function(){r.result.close();res(q.result?q.result.vitaminD:null)}}})`)
  const OLD_DAY = '2026-01-01'
  const rowIdx = (amt) => b.ev(`[...document.querySelectorAll(".feed-item")].findIndex(e=>e.querySelector(".amt").textContent===${JSON.stringify(amt)})`)

  try {
    // Phone A: two bottles, creates the family
    await open('A')
    for (const i of [0, 1]) { await b.click('#quick-grid button', i); await sleep(150) }
    await putOldDaily(OLD_DAY, true)
    await openSettings()
    await b.click('#share-create')
    await b.waitFor(`!!document.getElementById("share-code")`)
    const code = await b.text('#share-code')
    check('family code shown (26 characters in groups of 4)', /^([A-Z2-9]{4}-){6}[A-Z2-9]{2}$/.test(code), code)
    check('first sync sends A\'s bottles', await syncAndWait())
    equal('footer mentions sharing', await b.text('footer'), 'Données sur cet appareil, partagées avec ta famille (serveur en Europe).')
    await close()

    // Phone B: its own bottle and vitamin D; a wrong code first, then the right one
    await open('B')
    await b.click('#quick-grid button', 2); await sleep(150)
    await b.click('#vitd-btn'); await sleep(150)
    await putOldDaily(OLD_DAY, false)
    await openSettings()
    await b.setValue('#share-code-input', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG')
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-error")`)
    equal('unknown code refused', await b.text('#share-error'), 'Code inconnu. Vérifie-le et réessaie.')
    check('still not sharing', !(await b.exists('#share-code')))
    await b.setValue('#share-code-input', code.toLowerCase().replace(/-/g, ' '))
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    check('joined with a pasted, re-cased code', true)
    await syncAndWait()
    equal('histories merged without duplicates', await amounts(), '120 ml,60 ml,90 ml')
    equal('same pre-sharing day on both phones converges to the family copy', await getDaily(OLD_DAY), true)

    // B deletes the 60 ml bottle
    await b.click('.feed-item .del', await rowIdx('60 ml'))
    await sleep(100)
    await syncAndWait()
    await close()

    // A sees the merge, the deletion and B's vitamin D; deletes 90 ml then undoes it
    await open('A')
    await syncAndWait()
    equal('A: deletion and B\'s bottle received', await amounts(), '120 ml,90 ml')
    equal('A: vitamin D from B', await b.ev(`document.getElementById("vitd-btn").getAttribute("aria-pressed")`), 'true')
    equal('A: kept its copy of the pre-sharing day', await getDaily(OLD_DAY), true)
    await b.click('.feed-item .del', await rowIdx('90 ml'))
    await syncAndWait() // the deletion reaches the server
    await b.waitFor(`!!document.getElementById("toast-undo")`, 1000).catch(() => {})
    // the toast lasts 6 s: if it is gone, undo is not possible and the test is wrong
    check('undo still offered after the sync', await b.exists('#toast-undo'))
    await b.click('#toast-undo')
    await sleep(200)
    await syncAndWait()
    // A sets the birth date (shared baby settings)
    await b.setValue('#birth-date', '2026-06-01'); await sleep(100)
    await syncAndWait()
    await close()

    // B offline: edits 120 -> 125 and adds 150; nothing can be sent
    await open('B')
    await syncAndWait()
    equal('B: undo after a propagated deletion restores the bottle', await amounts(), '120 ml,90 ml')
    equal('B: birth date from A', await b.ev(`document.getElementById("birth-date") ? document.getElementById("birth-date").value : null`), '2026-06-01')
    store.down = true
    await b.click('.feed-item .edit', await rowIdx('120 ml'))
    await b.setValue('.feed-edit input[type=number]', '125')
    await b.click('.feed-edit .save'); await sleep(100)
    await b.click('#quick-grid button', 3); await sleep(100)
    await openSettings()
    await b.click('#share-now')
    await b.waitFor(`document.getElementById("share-status").textContent.indexOf("Hors ligne")===0`)
    check('offline status shown', true)
    check('changes kept in the outbox', (await outboxSize()) >= 2)
    await close()

    // A, online, edits the same bottle later: 120 -> 130 wins over B's earlier offline edit
    store.down = false
    await open('A')
    await syncAndWait()
    await b.click('.feed-item .edit', await rowIdx('120 ml'))
    await b.setValue('.feed-edit input[type=number]', '130')
    await b.click('.feed-edit .save'); await sleep(100)
    await syncAndWait()
    await close()

    await open('B')
    check('B: offline changes sent once back online', await syncAndWait())
    equal('B: latest edit wins (A\'s 130 over B\'s earlier 125), offline bottle kept', await amounts(), '130 ml,150 ml,90 ml')
    await b.click('#share-leave'); await sleep(200)
    check('leaving shows the create/join choice again', await b.exists('#share-create'))
    equal('data kept after leaving', await amounts(), '130 ml,150 ml,90 ml')
    equal('footer back to local', await b.text('footer'), 'Données stockées localement (IndexedDB) sur cet appareil.')
    await close()

    await open('A')
    await syncAndWait()
    equal('A: B\'s offline bottle arrived', await amounts(), '130 ml,150 ml,90 ml')
    await close()

    // B joins again, then A erases the family from the server
    await open('B')
    await openSettings()
    await b.setValue('#share-code-input', code)
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    await syncAndWait()
    await close()

    await open('A')
    await openSettings()
    await b.click('#share-delete')
    check('erasing asks for confirmation', await b.exists('#share-confirm'))
    await b.click('#share-delete-no')
    check('cancel keeps the family', (await b.exists('#share-code')) && store.families.size === 1)
    store.down = true
    await b.click('#share-delete'); await b.click('#share-delete-yes')
    await b.waitFor(`!!document.getElementById("share-error")`)
    equal('offline: nothing erased, error shown', [store.families.size, await b.text('#share-error')], [1, "Impossible d'effacer sans connexion. Réessaie plus tard."])
    store.down = false
    await b.click('#share-delete-yes')
    await b.waitFor(`!!document.getElementById("share-create")`)
    equal('family and its records erased from the server', store.families.size, 0)
    equal('A keeps its data', await amounts(), '130 ml,150 ml,90 ml')
    await close()

    await open('B')
    await b.waitFor(`(document.querySelector("#toast .toast-text")||{}).textContent==="La famille a été supprimée : le partage est arrêté, les données restent sur ce téléphone."`, 8000)
    check('B leaves on its own at the next sync', !(await b.ev('localStorage.getItem("suivi-lait-sync-v1")')))
    equal('B keeps its data', await amounts(), '130 ml,150 ml,90 ml')
    await close()
  } finally {
    if (b) await b.close()
    await srv.stop()
    rmSync(profiles.A, { recursive: true, force: true })
    rmSync(profiles.B, { recursive: true, force: true })
  }
}
