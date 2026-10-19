// Backup: export to a file, wipe, import it back (merge, no duplicates), bad files, and the "last bottle" duration.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

export async function run(DIST) {
  suite('Backup: export / import')
  const srv = await serve(DIST)
  const b = await launch()
  const dir = mkdtempSync(join(tmpdir(), 'milk-tracker-backup-'))
  const setFile = async (path) => {
    const { root } = await b.send('DOM.getDocument')
    const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' })
    await b.send('DOM.setFileInputFiles', { nodeId, files: [path] })
  }
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    await b.click('#quick-grid button', 0); await sleep(150)
    await b.click('#quick-grid button', 1)
    await b.waitFor(`document.getElementById("total-number").textContent==="150"`)
    await b.click('#settings-btn')
    await b.setValue('#birth-date', '2026-01-15')
    await sleep(200)

    // desktop (no touch): the export is a plain download
    await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
    await b.click('#export-btn')
    let file
    for (let i = 0; i < 50 && !file; i++) { await sleep(100); file = readdirSync(dir).find((f) => f.endsWith('.json')) }
    check('export downloads a .json file', !!file, readdirSync(dir).join(','))
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    equal('file content', [data.app, data.version, data.feeds.length, data.baby.birthDate], ['milk-tracker', 1, 2, '2026-01-15'])
    equal('export toast', await b.text('#toast .toast-text'), 'Sauvegarde exportée')

    // wipe everything, as on a new phone
    await b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var tx=r.result.transaction(["feeds","daily"],"readwrite");tx.objectStore("feeds").clear();tx.objectStore("daily").clear();tx.oncomplete=function(){r.result.close();res(1)}}})`)
    await b.ev(`localStorage.removeItem("suivi-lait-baby-v1")`)
    await b.reload()
    equal('wiped', await b.text('#total-number'), '0')

    await b.click('#settings-btn')
    await setFile(join(dir, file))
    await b.waitFor(`document.getElementById("total-number").textContent==="150"`)
    equal('import toast', await b.text('#toast .toast-text'), '2 biberons importés')
    equal('baby settings restored', await b.ev(`document.getElementById("birth-date").value`), '2026-01-15')

    await setFile(join(dir, file))
    await sleep(500)
    equal('importing twice does not duplicate', [await b.count('.feed-item'), await b.text('#total-number')], [2, '150'])

    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{"hello": 1}')
    await setFile(bad)
    await b.waitFor(`(document.querySelector("#toast .toast-text")||{}).textContent==="Fichier non reconnu"`)
    check('unknown file is refused', true)

    // one valid row 2 h 40 min ago (any day: "last bottle" looks across days) and one invalid row
    const mixed = join(dir, 'mixed.json')
    const t = new Date(Date.now() - 160 * 60000)
    const day = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    writeFileSync(mixed, JSON.stringify({ app: 'milk-tracker', version: 1, feeds: [
      { id: 'imp-1', date: day, ml: 120, time: t.toISOString() },
      { id: 'imp-2', date: 'yesterday', ml: -5, time: 'x' },
    ], daily: [] }))
    // make the most recent feed the imported one: drop today's two first
    await b.ev(`new Promise(function(res){var r=indexedDB.open("suivi-lait-db");r.onsuccess=function(){var tx=r.result.transaction(["feeds"],"readwrite");tx.objectStore("feeds").clear();tx.oncomplete=function(){r.result.close();res(1)}}})`)
    await setFile(mixed)
    await b.waitFor(`(document.querySelector("#toast .toast-text")||{}).textContent.indexOf("importé")>0`)
    equal('bad rows are skipped and counted', await b.text('#toast .toast-text'), '1 biberon importé · 1 ligne ignorée')
    equal('last bottle duration', await b.text('#last-feed'), 'Dernier biberon il y a 2 h 40 min')
    await b.setValue('#lang-select', 'ar'); await sleep(200)
    equal('last bottle in Arabic', await b.text('#last-feed'), 'آخر رضعة منذ 2 س 40 د')
    equal('no JS errors', b.errors.filter((e) => !/Erreur import/.test(e)), [])
  } finally {
    await b.close()
    await srv.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
