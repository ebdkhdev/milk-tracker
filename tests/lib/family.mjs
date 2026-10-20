// Account steps shared by the end-to-end tests (fake Neon Auth, see fakeauth.mjs).
import { sleep } from './browser.mjs'
import { TEST_CODE } from './fakeauth.mjs'

export const PASSWORD = 'correct horse 42'

export async function openSettings(b) { if (!(await b.exists('#settings'))) await b.click('#settings-btn') }

// creates the account (or signs in when `existing`) and waits until the phone syncs through it
export async function signUp(b, email, name = '', existing = false) {
  await openSettings(b)
  await b.click(existing ? '#mode-signin' : '#mode-signup')
  if (!existing && name) await b.setValue('#auth-name', name)
  await b.setValue('#auth-email', email)
  await b.setValue('#auth-password', PASSWORD)
  await b.click('#auth-submit')
  await b.waitFor(`!!document.getElementById("account-email")`, 8000)
  await b.waitFor(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).account===true`, 8000)
  await b.waitFor(`!!(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync`, 8000)
}

export async function verifyEmail(b) {
  await openSettings(b)
  await b.click('#verify-send')
  await b.waitFor(`!!document.getElementById("verify-code")`)
  await b.setValue('#verify-code', TEST_CODE)
  await b.click('#verify-submit')
  await b.waitFor(`!document.getElementById("verify-email")`)
}

export async function invite(b, email) {
  await openSettings(b)
  await b.setValue('#invite-email', email)
  await b.click('#invite-submit')
  await b.waitFor(`(document.getElementById("household-message")||{}).textContent && document.getElementById("household-message").textContent.indexOf(${JSON.stringify(email)})>=0`)
}

// the invited phone: verify the email if needed, then accept the (first) invitation
export async function acceptInvite(b) {
  await openSettings(b)
  await b.waitFor(`!!document.querySelector("[id^=accept-]")`, 8000)
  if (await b.exists('#verify-send')) await verifyEmail(b)
  await b.click('[id^=accept-]')
  await b.waitFor(`(document.getElementById("household-message")||{}).textContent==="Famille rejointe : vos données sont réunies"`, 8000)
}

// forces a sync and waits until the outbox is empty and the sync time moved
export async function syncAndWait(b) {
  await openSettings(b)
  const before = await b.ev(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync||""`)
  await sleep(5)
  await b.click('#share-now')
  await b.waitFor(`(JSON.parse(localStorage.getItem("suivi-lait-sync-v1"))||{}).lastSync > ${JSON.stringify(before)}`, 8000)
  await sleep(400)
}
