// Notifications, end to end: enabling (permission + subscription), what the phone tells the server, the
// other parent's bottle pushed through /api/sync, turning off, and the iPhone-in-Safari case.
// The browser's push subscription is stubbed (headless Chrome has no push service); server code is real.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tokenHash } from '../api/_push.mjs'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { fakeScheduler, fakeSender, memoryPushStore, memoryStore } from './lib/memory-store.mjs'

const pad = (n) => String(n).padStart(2, '0')
const day = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
// stands in for the browser's push service: a fixed endpoint per profile
const STUB = (n) => `(function(){
  var sub = { endpoint: "https://push.example/phone-${n}", toJSON: function(){ return { endpoint: this.endpoint, keys: { p256dh: "${'p'.repeat(87)}", auth: "${'a'.repeat(22)}" } } }, unsubscribe: function(){ window.__unsubscribed = true; return Promise.resolve(true) } };
  // like a real browser, the subscription outlives the page
  sub.unsubscribe = function(){ localStorage.removeItem("test-push-sub"); window.__unsubscribed = true; return Promise.resolve(true) };
  PushManager.prototype.subscribe = function(){ localStorage.setItem("test-push-sub", "1"); return Promise.resolve(sub) };
  PushManager.prototype.getSubscription = function(){ return Promise.resolve(localStorage.getItem("test-push-sub") ? sub : null) };
})()`

export async function run(DIST) {
  suite('Notifications (app closed)')
  const syncStore = memoryStore()
  const pushStore = memoryPushStore()
  pushStore.familyId = async (h) => (syncStore.families.has(h) ? h : null) // the sync store keys families by hash
  const scheduler = fakeScheduler(), sender = fakeSender()
  syncStore.push = { store: pushStore, scheduler, sender, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }
  const srv = await serve(DIST, 8765, syncStore)
  const dir = mkdtempSync(join(tmpdir(), 'mt-notify-'))
  const profiles = { A: mkdtempSync(join(tmpdir(), 'mt-notif-a-')), B: mkdtempSync(join(tmpdir(), 'mt-notif-b-')) }
  let b = null
  const open = async (phone, ua) => {
    b = await launch({ profile: profiles[phone] })
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB(phone) })
    if (ua) await b.send('Emulation.setUserAgentOverride', { userAgent: ua })
    await b.send('Browser.grantPermissions', { origin: srv.url.replace(/\/$/, ''), permissions: ['notifications'] })
    await b.goto(srv.url)
    if (!(await b.ev('localStorage.getItem("suivi-lait-lang-v1")'))) { await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload() }
    await b.ev('navigator.serviceWorker.ready.then(function(){return 1})')
  }
  const close = async () => { equal('no JS errors', b.errors.filter((e) => !/Failed to fetch|ERR_|net::/.test(e)), []); await b.close(); b = null }
  const openSettings = async () => { if (!(await b.exists('#settings'))) await b.click('#settings-btn') }
  const subOf = async () => pushStore.subs.get(tokenHash(await b.ev(`JSON.parse(localStorage.getItem("suivi-lait-push-v1")).token`)))
  const waitSub = async (pred, what) => {
    for (let i = 0; i < 60; i++) { const s = await subOf(); if (s && pred(s)) return s; await sleep(100) }
    throw new Error('server never got: ' + what)
  }

  try {
    await open('A')
    await openSettings()
    check('offered with an explanation', (await b.exists('#notif-enable')) && (await b.text('.share-intro')).length > 0)
    await b.click('#notif-enable')
    await b.waitFor(`(document.querySelector("#toast .toast-text")||{}).textContent==="Notifications activées"`)
    let sub = await waitSub(() => true, 'subscription')
    equal('subscribed with language, time zone and endpoint', [sub.endpoint, sub.lang, typeof sub.tz], ['https://push.example/phone-A', 'fr', 'string'])
    equal('vitamin D follows the daily reminder (off)', await b.text('#notif-vitd'), 'Vitamine D : active le rappel « chaque matin » dans la carte Vitamine D')

    // the daily reminder switch drives the vitamin D push schedule
    await b.click('#reminder-enabled')
    sub = await waitSub((s) => s.vitd, 'vitamin D on')
    equal('reminder on: schedule at its time', scheduler.calls.filter((c) => c[0] === 'vitd').pop().slice(2, 4), [true, '08:00'])
    await b.click('#vitd-btn')
    sub = await waitSub((s) => s.vitdGivenDate, 'vitamin D given')
    equal('vitamin D given today is reported', sub.vitdGivenDate, day(new Date()))

    // bottles every 3 h: the expected next bottle is scheduled
    const t0 = Date.now()
    const feeds = [600, 420, 240, 60].map((m, i) => { const d = new Date(t0 - m * 60000); return { id: 'n' + i, date: day(d), ml: 100, time: d.toISOString() } })
    writeFileSync(join(dir, 'f.json'), JSON.stringify({ app: 'milk-tracker', version: 1, feeds, daily: [] }))
    await b.setFiles('#import-file', [join(dir, 'f.json')])
    for (let i = 0; i < 60 && !scheduler.calls.some((c) => c[0] === 'next'); i++) await sleep(100)
    const next = scheduler.calls.filter((c) => c[0] === 'next').pop()
    check('next bottle scheduled 3 h after the last one', next && Math.abs(next[3] - (t0 - 60 * 60000 + 180 * 60000)) < 2000, JSON.stringify(next))

    // family: A creates it; B (another phone, no notifications) adds a bottle -> A is notified, B is not
    await b.click('#share-create')
    await b.waitFor(`!!document.getElementById("share-code")`)
    const code = await b.text('#share-code')
    await b.type('#device-name', 'Maman')
    sub = await waitSub((s) => s.familyId, 'family link')
    check('A linked to the family on the server', !!sub.familyId)
    check('partner notifications on by default in a family', (await b.exists('#notif-partner')) && sub.partner)
    await close()

    await open('B')
    await openSettings()
    await b.setValue('#share-code-input', code)
    await b.click('#share-join')
    await b.waitFor(`!!document.getElementById("share-code")`)
    await sleep(2500) // joining syncs once
    sender.sent.length = 0
    await b.type('#device-name', 'Papa')
    await b.click('#quick-grid button', 3)
    for (let i = 0; i < 60 && !sender.sent.length; i++) await sleep(100)
    equal('A gets "Papa a ajouté un biberon"', sender.sent.map((s) => [s.to, s.title, s.body.replace(/\d\d:\d\d/, 'HH:MM')]), [['https://push.example/phone-A', 'Papa a ajouté un biberon', '150 ml à HH:MM']])
    await close()

    // A turns notifications off: subscription and schedule removed
    await open('A')
    await openSettings()
    await b.click('#notif-disable')
    for (let i = 0; i < 40 && pushStore.subs.size; i++) await sleep(100)
    check('turned off: server forgets the phone', pushStore.subs.size === 0, JSON.stringify([...pushStore.subs.values()].map((s) => [s.endpoint, s.familyId, s.name])))
    check('and the browser subscription is removed', await b.ev('!!window.__unsubscribed'))
    check('and offers to turn them on again', await b.exists('#notif-enable'))
    await close()

    // iPhone in Safari (not installed): explain how to get notifications instead of offering them
    b = await launch()
    await b.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' })
    await b.goto(srv.url)
    await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload()
    await openSettings()
    equal('iPhone in Safari: install first', await b.text('#notif-unavailable'), "Sur iPhone, installe d'abord l'app (Partager › Sur l'écran d'accueil) et ouvre-la depuis son icône pour activer les notifications.")
    await close()
  } finally {
    if (b) await b.close()
    await srv.stop()
    for (const d of [dir, profiles.A, profiles.B]) rmSync(d, { recursive: true, force: true })
  }
}
