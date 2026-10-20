// Accounts end to end, with the fake Neon Auth: signing up moves the local history to the server, signing out
// keeps it on the phone, a second device of the same account gets it, an invited parent (verified email)
// joins and both histories merge, a phone sharing with a family code moves to accounts keeping its family,
// and the password / Google paths.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { fakeAuth, TEST_CODE } from './lib/fakeauth.mjs'
import { PASSWORD, acceptInvite, invite, openSettings, signUp, syncAndWait } from './lib/family.mjs'
import { memoryAccountStore, memoryStore } from './lib/memory-store.mjs'

export async function run(DIST) {
  suite('Accounts (sign-up, devices, invitations)')
  const store = memoryStore()
  const accounts = memoryAccountStore(store)
  const auth = await fakeAuth(accounts)
  store.account = { store: accounts, keys: auth.keys }
  store.fakeAuth = auth
  const srv = await serve(DIST, 8765, store)
  const dirs = ['A', 'B', 'C', 'E', 'G'].map((p) => [p, mkdtempSync(join(tmpdir(), 'mt-acct-' + p + '-'))])
  const profiles = Object.fromEntries(dirs)
  let b = null
  const open = async (phone) => {
    b = await launch({ profile: profiles[phone], fakeAuth: true })
    await b.goto(srv.url)
    if (!(await b.ev('localStorage.getItem("suivi-lait-lang-v1")'))) { await b.ev('localStorage.setItem("suivi-lait-lang-v1","fr")'); await b.reload() }
  }
  const close = async () => { equal('no JS errors', b.errors.filter((e) => !/Failed to fetch|ERR_|net::/.test(e)), []); await b.close(); b = null }
  const amounts = () => b.ev(`[...document.querySelectorAll(".feed-item .amt")].map(e=>e.textContent).sort().join(",")`)
  const familyOf = (email) => accounts.members.get([...accounts.users.values()].find((u) => u.email === email).id)
  const serverFeeds = (familyId) => [...(store.families.get(familyId) || new Map()).values()].filter((r) => r.kind === 'feed' && !r.deleted).map((r) => r.data.ml).sort()

  try {
    // ---- A: bottles first, then an account: the history goes to the server ----
    await open('A')
    for (const i of [0, 1]) { await b.click('#quick-grid button', i); await sleep(150) }
    await openSettings(b)
    check('signed out: invitation to sign in to share', await b.exists('#share-signin-note'))
    await b.click('#mode-signin')
    await b.setValue('#auth-email', 'maman@example.com'); await b.setValue('#auth-password', 'wrong password')
    await b.click('#auth-submit')
    await b.waitFor(`!!document.getElementById("account-message")`)
    equal('unknown account: clear error', await b.text('#account-message'), 'Email ou mot de passe incorrect.')
    await signUp(b, 'maman@example.com', 'Maman')
    equal('account: local history uploaded to the server', serverFeeds(familyOf('maman@example.com')), [60, 90])
    equal('footer says the account keeps the data', await b.text('footer'), 'Données enregistrées sur ton compte (serveur en Europe) et sur cet appareil.')
    await b.click('#sign-out'); await sleep(300)
    equal('signed out: data kept on the phone', [await amounts(), await b.ev('localStorage.getItem("suivi-lait-sync-v1")')], ['60 ml,90 ml', null])
    await b.click('#quick-grid button', 2); await sleep(150) // 120 ml while signed out
    await signUp(b, 'maman@example.com', '', true)
    equal('signing in again: bottle added meanwhile sent, nothing duplicated', serverFeeds(familyOf('maman@example.com')), [120, 60, 90])
    await close()

    // ---- B: another device of the same account gets everything ----
    await open('B')
    await signUp(b, 'maman@example.com', '', true)
    await syncAndWait(b)
    equal('second device: the account\'s bottles', await amounts(), '120 ml,60 ml,90 ml')
    await close()

    // ---- C: Papa has his own account and a bottle; Maman invites him ----
    await open('C')
    await b.click('#quick-grid button', 3); await sleep(150) // 150 ml
    await signUp(b, 'papa@example.com', 'Papa')
    await close()
    await open('A')
    await invite(b, 'papa@example.com')
    check('pending invitation listed', (await b.text('.pending-invite')).includes('papa@example.com'))
    await close()
    await open('C')
    await openSettings(b)
    await b.waitFor(`!!document.querySelector("[id^=accept-]")`)
    equal('invitation names the inviter', await b.ev(`document.querySelector("[id^=invite-] p").textContent`), 'Maman t\'invite à rejoindre sa famille')
    check('joining needs a verified email first', await b.ev(`document.querySelector("[id^=accept-]").disabled`))
    await acceptInvite(b)
    await syncAndWait(b)
    equal('Papa: both histories merged', await amounts(), '120 ml,150 ml,60 ml,90 ml')
    check('same household on the server', familyOf('papa@example.com') === familyOf('maman@example.com'))
    equal('members', await b.ev(`[...document.querySelectorAll("#members li")].map(e=>e.firstChild.textContent).join(" | ")`), 'Maman | Papa (toi)')
    await close()
    await open('A')
    await syncAndWait(b)
    equal('Maman gets Papa\'s bottle', await amounts(), '120 ml,150 ml,60 ml,90 ml')
    await close()

    // ---- E: a phone that shared with a family code (before accounts) keeps its family when signing in ----
    const created = await (await fetch(srv.url + 'api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create' }) })).json()
    await open('E')
    await b.ev(`localStorage.setItem("suivi-lait-sync-v1", JSON.stringify({ code: ${JSON.stringify(created.code)}, cursor: 0, lastSync: null }))`)
    await b.reload()
    await b.click('#quick-grid button', 1); await sleep(150) // 90 ml, queued for the code family
    await openSettings(b)
    check('code family shown with a note about accounts', (await b.exists('#legacy-code-note')) && (await b.exists('#share-code')))
    await b.click('#share-now'); await sleep(800)
    await signUp(b, 'oncle@example.com', 'Oncle')
    const codeFamily = [...store.families.keys()].find((k) => k !== familyOf('maman@example.com') && serverFeeds(k).includes(90) && k.length === 64)
    check('account linked to the code family (no new household)', familyOf('oncle@example.com') === codeFamily, JSON.stringify([familyOf('oncle@example.com'), codeFamily]))
    await close()

    // ---- G: password reset by email code, and Google ----
    await open('G')
    await openSettings(b)
    await b.click('#auth-forgot')
    await b.setValue('#reset-email', 'papa@example.com'); await b.click('#reset-send')
    await b.waitFor(`!!document.getElementById("reset-code")`)
    await b.setValue('#reset-code', TEST_CODE); await b.setValue('#reset-password', 'new password 99')
    await b.click('#reset-submit')
    await b.waitFor(`!!document.getElementById("account-form")`)
    await b.setValue('#auth-email', 'papa@example.com'); await b.setValue('#auth-password', 'new password 99')
    await b.click('#auth-submit')
    await b.waitFor(`!!document.getElementById("account-email")`, 8000)
    check('reset password works', (await b.text('#account-email')).includes('papa@example.com'))
    void PASSWORD
    await b.click('#sign-out'); await sleep(300)
    await b.ev('localStorage.setItem("test-google-email", "grand-mere@example.com")')
    await b.click('#auth-google')
    await b.waitFor(`!!document.getElementById("account-email")`, 8000)
    check('Google account: signed in, email already verified', !(await b.exists('#verify-email')))
    await close()
  } finally {
    if (b) await b.close()
    await srv.stop()
    for (const [, d] of dirs) rmSync(d, { recursive: true, force: true })
  }
}
