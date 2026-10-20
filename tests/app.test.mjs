// Main flow: migration, adding/editing/deleting feeds (with undo), last bottle, past days, stats, units, languages.
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

export async function run(DIST) {
  suite('App: main flow')
  const srv = await serve(DIST)
  const b = await launch()
  try {
    await b.goto(srv.url)
    // an existing v1 user: data still under the pre-IndexedDB key, settings saved, no language chosen
    await b.ev(`(function(){var d=new Date();d.setDate(d.getDate()-2);
      var ds=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      localStorage.setItem("suivi-lait-data-v1", JSON.stringify({[ds]:[{id:"legacy1",ml:200,time:new Date(ds+"T09:30:00").toISOString()},{id:"legacy2",ml:450,time:new Date(ds+"T15:00:00").toISOString()}]}));
      localStorage.setItem("suivi-lait-unit-v1","ml"); localStorage.removeItem("suivi-lait-lang-v1");
      localStorage.setItem("suivi-lait-reminder-v1", JSON.stringify({enabled:true,time:"00:01",lastNotified:null}));})()`)
    await b.reload()
    await sleep(300)
    equal('existing user stays in French', await b.ev('document.documentElement.lang'), 'fr')
    equal('legacy key removed after migration', await b.ev('localStorage.getItem("suivi-lait-data-v1")'), null)
    equal('empty today', await b.text('#total-number'), '0')
    check('no "last bottle" when the last one is over 24 h old', !(await b.exists('#last-feed')))

    for (const i of [3, 3, 1]) { await b.click('#quick-grid button', i); await sleep(150) }
    await b.waitFor(`document.getElementById("total-number").textContent==="390"`)
    equal('three quick adds', await b.text('#total-sub'), '3 biberons')
    equal('last bottle just now', await b.text('#last-feed'), "Dernier biberon à l'instant")

    await b.setValue('#custom-amount', '75')
    await b.click('#custom-add')
    await b.waitFor(`document.getElementById("total-number").textContent==="465"`)
    await b.click('#vitd-btn')
    await b.waitFor(`document.getElementById("vitd-btn").getAttribute("aria-pressed")==="true"`)
    check('vitamin D given', true)

    await b.click('.feed-item .edit')
    await b.setValue('.feed-edit input[type=number]', '100')
    await b.click('.feed-edit .save')
    await b.waitFor(`document.getElementById("total-number").textContent==="490"`)
    check('edit 75 -> 100', true)

    await b.click('.feed-item .del', 1)
    await b.waitFor(`document.querySelectorAll(".feed-item").length===3`)
    equal('delete shows an undo toast', await b.text('#toast .toast-text'), 'Biberon supprimé')
    await b.click('#toast-undo')
    await b.waitFor(`document.querySelectorAll(".feed-item").length===4`)
    equal('undo restores the bottle', await b.text('#total-number'), '490')
    check('toast closes after undo', !(await b.exists('#toast')))

    await b.click('.feed-item .del', 0)
    await b.waitFor(`document.querySelectorAll(".feed-item").length===3`)
    await b.waitFor(`!document.getElementById("toast")`, 8000)
    check('toast disappears on its own', true)
    await b.reload()
    equal('deletion without undo is kept', await b.count('.feed-item'), 3)

    await b.click('#prev-day'); await sleep(200)
    await b.click('#prev-day')
    await b.waitFor(`document.getElementById("total-number").textContent==="650"`)
    check('migrated legacy day', true)
    check('no "last bottle" on past days', !(await b.exists('#last-feed')))
    equal('time field shown on past days', await b.ev(`getComputedStyle(document.getElementById("custom-time")).display`), 'block')
    await b.setValue('#custom-time', '10:15')
    await b.click('#quick-grid button', 0)
    await b.waitFor(`document.getElementById("total-number").textContent==="710"`)
    check('past-day add uses the chosen time', (await b.ev(`[...document.querySelectorAll(".feed-item .time")].map(e=>e.textContent).join(",")`)).includes('10:15'))

    await b.tab('stats')
    await b.click('.history-row', 0)
    await b.waitFor(`!!document.getElementById("last-feed")`)
    check('history row opens today on the bottles tab', await b.ev(`document.getElementById("tab-feeds").getAttribute("aria-current")==="page"`))
    await b.tab('stats')
    await b.click('#period-30'); await sleep(200)
    equal('30 days of history', await b.count('.history-row'), 30)
    await b.tab('feeds')

    await b.click('#unit-oz'); await sleep(200)
    equal('ounces', await b.text('#total-unit-label'), 'oz')
    await b.setValue('#lang-select', 'en'); await sleep(200)
    check('English', (await b.text('#last-feed')).startsWith('Last bottle'))
    await b.setValue('#lang-select', 'ar'); await sleep(200)
    equal('Arabic is right-to-left', await b.ev('document.documentElement.dir'), 'rtl')
    equal('Arabic unit', await b.text('#total-unit-label'), 'أونصة')

    await b.reload()
    equal('settings persist', [await b.ev('document.documentElement.lang'), await b.text('#total-unit-label')], ['ar', 'أونصة'])
    equal('feeds persist', await b.count('.feed-item'), 3)
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
  }
}
