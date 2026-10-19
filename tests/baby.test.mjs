// Age-based minimum: tiers follow the baby's age on each day, values are editable, ml/oz round-trips don't drift.
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

export async function run(DIST) {
  suite('Baby: minimum by age')
  const srv = await serve(DIST)
  const b = await launch()
  const target = () => b.text('#goal-target')
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    await b.click('#quick-grid button', 3)
    await b.click('#settings-btn')
    equal('no birth date: 600 ml', await target(), 'min. 600 ml')

    // born 2 months and 3 days ago: today is in the 2–4 months band (700), 4 days ago in 1–2 months (600)
    const bd = await b.ev(`(function(){var d=new Date();d.setMonth(d.getMonth()-2);d.setDate(d.getDate()-3);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")})()`)
    await b.setValue('#birth-date', bd); await sleep(200)
    check('today uses the 2–4 months band', (await target()).startsWith('min. 700 ml · 2 mois'), await target())
    equal('current band marked', await b.ev(`[...document.querySelectorAll("#tiers .tier")].findIndex(t=>t.classList.contains("current"))`), 2)

    // real typing: focus the 2–4 months field, type 800, Enter
    const r = await b.ev(`(function(){var e=document.querySelector("#tiers .tier:nth-child(3) input");e.scrollIntoView({block:"center"});var r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 })
    await b.ev('document.activeElement.select()')
    await b.send('Input.insertText', { text: '800' })
    for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(200)
    check('edited band value applies', (await target()).startsWith('min. 800 ml'), await target())

    await b.click('#unit-oz'); await sleep(200)
    await b.ev(`(function(){var e=document.querySelector("#tiers .tier:nth-child(3) input");e.focus();e.blur()})()`)
    await b.click('#unit-ml'); await sleep(200)
    check('oz focus/blur does not shift the ml value', (await target()).startsWith('min. 800 ml'), await target())

    await b.reload()
    check('persists after reload', (await target()).startsWith('min. 800 ml'), await target())
    for (let i = 0; i < 4; i++) { await b.click('#prev-day'); await sleep(100) }
    check('4 days ago uses the age on that day', (await target()).startsWith('min. 600 ml · 1 mois'), await target())

    await b.click('#settings-btn')
    await b.click('#tiers-reset'); await sleep(200)
    equal('reset restores defaults', await b.ev(`[...document.querySelectorAll("#tiers input")].map(i=>i.value).join(",")`), '500,600,700,750,700')
    await b.setValue('#birth-date', ''); await sleep(200)
    equal('clearing the birth date goes back to 600', await target(), 'min. 600 ml')
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
  }
}
