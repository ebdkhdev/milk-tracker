// Touch targets, text scaling up to 200%, and narrow phones (no horizontal scroll, one-line top bar).
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

// Controls that are visually smaller than 44 pt on purpose (iOS segmented controls and switch);
// they still must reach Apple's 28 pt minimum.
const SMALL_OK = ['#unit-ml', '#unit-oz', '#period-7', '#period-30', '#reminder-enabled', '#track-milk', '#sex-f', '#sex-m', '#growth-weight', '#growth-length', '#growth-head', '#mode-signin', '#mode-signup']

export async function run(DIST) {
  suite('Layout: touch targets, text size, narrow screens')
  const srv = await serve(DIST)
  const b = await launch()
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    for (const i of [3, 2]) { await b.click('#quick-grid button', i); await sleep(150) }
    await b.click('.feed-item .edit', 0)
    await b.setValue('.feed-note-input', 'Une note assez longue pour vérifier le retour à la ligne : régurgitation après le biberon, à surveiller demain matin')
    await b.click('.feed-edit .save'); await sleep(200)
    await b.click('.feed-item .del', 1) // shows the toast with its undo button

    // every tab, plus the tab bar itself (the settings panel stays open on the first one)
    const tabs = await b.ev(`[...document.querySelectorAll(".tabbar button")].map(function(e){return e.id.slice(4)})`)
    const targets = []
    for (const name of tabs) {
      await b.tab(name)
      if (name === tabs[0]) { await b.click('#settings-btn'); await sleep(200) }
      targets.push(...(await b.ev(`(function(){
      var out=[];
      document.querySelectorAll("button,a,select,input:not(.visually-hidden),label.data-btn,.history-row").forEach(function(e){
        var r=e.getBoundingClientRect(); if(!r.width || getComputedStyle(e).pointerEvents==="none") return;
        // a transparent ::after overlay extends the hit area
        var a=getComputedStyle(e,"::after"), ext=0;
        if(a.content!=="none" && a.position==="absolute") ext=-parseFloat(a.top)||0;
        var key=e.id?"#"+e.id:(e.className||e.tagName).toString().split(" ")[0];
        out.push([key, Math.round(r.width), Math.round(r.height+2*ext)]);
      });
      return out;})()`)).map(([k, w, h]) => [name + ' ' + k, w, h]))
    }
    await b.tab(tabs[0])
    const small = targets.filter(([k, w, h]) => (w < 44 || h < 44) && !SMALL_OK.includes(k.split(' ')[1]) && !(k.endsWith('#settings-btn') && h >= 44 && w >= 36))
    check(`touch targets >= 44 pt (${targets.length} checked)`, small.length === 0, JSON.stringify(small))
    const tiny = targets.filter(([, w, h]) => w < 28 || h < 28)
    check('nothing below the 28 pt minimum', tiny.length === 0, JSON.stringify(tiny))

    const overflow = () => b.ev(`(function(){var W=document.documentElement.clientWidth, over=[];
      document.querySelectorAll(".wrap *, .toast *, .tabbar *").forEach(function(e){var r=e.getBoundingClientRect(); if(r.width && (r.right>W+1||r.left<-1) && !e.closest(".visually-hidden,.brand-name")) over.push(e.id||e.className||e.tagName)});
      return {scroll: document.documentElement.scrollWidth>W, over: over.slice(0,6)}})()`)
    for (const pct of [150, 200]) {
      await b.ev(`document.documentElement.style.fontSize="${pct * 1.0625}%"`); await sleep(200)
      equal(`no horizontal overflow at ${pct}% text`, await overflow(), { scroll: false, over: [] })
    }
    await b.ev(`document.documentElement.style.fontSize=""`)

    for (const lang of ['fr', 'en', 'ar']) {
      await b.setValue('#lang-select', lang)
      for (const w of [320, 360]) {
        await b.viewport(w, 700); await sleep(200)
        equal(`${lang} ${w}px: no overflow`, await overflow(), { scroll: false, over: [] })
        const bar = await b.ev(`(function(){var h=document.querySelector("header"),c=document.querySelector(".header-controls"),n=document.querySelector(".brand");
          return {oneLine: c.getBoundingClientRect().height<=48, brandFits: n.scrollWidth<=n.clientWidth+1}})()`)
        equal(`${lang} ${w}px: top bar on one line, name not cut`, bar, { oneLine: true, brandFits: true })
        equal(`${lang} ${w}px: no tab label cut`, await b.ev(`[...document.querySelectorAll(".tab-label")].filter(function(e){return e.scrollWidth>e.clientWidth+1}).map(function(e){return e.textContent})`), [])
      }
    }
    // a much wider font (some Android / Linux system fonts): the name is hidden rather than cut
    await b.ev(`document.body.style.fontFamily="Verdana, 'DejaVu Sans Mono', monospace"`)
    for (const w of [340, 390]) {
      await b.viewport(w, 700); await sleep(300)
      equal(`wide font ${w}px: name not cut`, await b.ev(`(function(){var n=document.querySelector(".brand");return n.scrollWidth<=n.clientWidth+1})()`), true)
    }
    await b.ev(`document.body.style.fontFamily=""`); await b.viewport(320, 700); await sleep(300)
    equal('name still in the accessible text at 320px', await b.ev(`document.querySelector(".brand").textContent`), '🍼 Milk Tracker')
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
  }
}
