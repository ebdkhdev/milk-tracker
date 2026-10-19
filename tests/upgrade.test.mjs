// Upgrade from v1.0.0 (single index.html + service worker) on the same origin: data and settings are kept,
// the new service worker takes over, old caches are purged, and the app still works offline.
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep, waitFor } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

export async function run(DIST) {
  suite('Upgrade from v1.0.0')
  const v1 = mkdtempSync(join(tmpdir(), 'milk-tracker-v1-'))
  const profile = mkdtempSync(join(tmpdir(), 'milk-tracker-upgrade-'))
  try {
    execSync(`git archive v1.0.0 | tar -x -C "${v1}"`, { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    check('v1.0.0 tag available (git fetch --tags)', false, String(e.stderr || e))
    return
  }
  const srv = await serve(v1)
  let b = await launch({ profile })
  try {
    // v1 renders without React, so wait for its own elements
    await b.send('Page.navigate', { url: srv.url })
    await waitFor(b.ev, `!!document.querySelector("#quick-grid button")`, 15000)
    for (let i = 0; i < 3; i++) { await b.click('#quick-grid button', 2); await sleep(200) }
    await b.click('#vitd-btn'); await sleep(200)
    await b.ev(`(function(){var c=document.getElementById("reminder-enabled");c.checked=true;c.dispatchEvent(new Event("change"))})()`)
    await b.ev(`(function(){var s=document.getElementById("lang-select");s.value="ar";s.dispatchEvent(new Event("change"))})()`)
    await b.click('#unit-oz'); await sleep(200)
    await b.ev(`navigator.serviceWorker.ready.then(function(){return 1})`)
    await b.send('Page.reload'); await sleep(1000)
    check('v1 controlled by its service worker', await b.ev('!!navigator.serviceWorker.controller'))
  } finally {
    await b.close()
  }

  srv.setDir(DIST)
  b = await launch({ profile })
  try {
    // first load is served by the old worker; the new one installs, takes over, and the next loads are new
    await b.send('Page.navigate', { url: srv.url }); await sleep(2000)
    for (let i = 0; i < 2; i++) { await b.send('Page.reload'); await sleep(2000) }
    await waitFor(b.ev, `!!document.getElementById("total-number")`, 15000)
    const state = () => b.ev(`({ dir: document.documentElement.dir, unit: document.getElementById("total-unit-label").textContent,
      feeds: document.querySelectorAll(".feed-item").length, vitd: document.getElementById("vitd-btn").getAttribute("aria-pressed"),
      reminder: document.getElementById("reminder-enabled").checked })`)
    const expected = { dir: 'rtl', unit: 'أونصة', feeds: 3, vitd: 'true', reminder: true }
    equal('data and settings kept', await state(), expected)
    const caches = await b.ev(`caches.keys().then(function(k){return k})`)
    check('only the new cache remains', caches.length === 1 && /^milk-tracker-[0-9a-f]+$/.test(caches[0]), JSON.stringify(caches))
    check('new worker controls the page', await b.ev('!!navigator.serviceWorker.controller'))

    await srv.stop()
    await b.send('Page.reload'); await sleep(1500)
    await waitFor(b.ev, `!!document.getElementById("total-number")`, 15000)
    equal('works offline', await state(), expected)
    equal('no JS errors', b.errors.filter((e) => !/Failed to load|ERR_CONNECTION_REFUSED/.test(e)), [])
  } finally {
    await b.close()
    rmSync(v1, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  }
}
