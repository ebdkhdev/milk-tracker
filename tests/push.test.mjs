// Push notifications: protocol and fire-time decisions (api/_push.mjs) with fakes; no browser, no network.
import { handleFire, handlePush, localParts, notifyPartners, tokenHash } from '../api/_push.mjs'
import { hashCode, newCode } from '../api/_core.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { fakeScheduler, fakeSender, memoryPushStore } from './lib/memory-store.mjs'

const subscription = (n) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } })
const T1 = 'device-token-one-0123456789', T2 = 'device-token-two-0123456789', T3 = 'device-token-three-012345678'

export async function run() {
  suite('Push notifications (server)')
  const store = memoryPushStore(), scheduler = fakeScheduler(), sender = fakeSender(new Set(['https://push.example/gone']))
  const deps = { store, scheduler, sender, publicKey: 'PUBLIC' }
  const push = (body, token, familyCode) => handlePush({ body, token, familyCode }, deps)

  equal('public key', (await push({ action: 'key' })).body, { publicKey: 'PUBLIC' })
  equal('device token required', (await push({ action: 'subscribe', subscription: subscription(1) })).status, 401)
  equal('bad subscription refused', (await push({ action: 'subscribe', subscription: { endpoint: 'http://x' } }, T1)).status, 400)
  equal('subscribe', (await push({ action: 'subscribe', subscription: subscription(1), lang: 'fr', tz: 'Europe/Paris', prefs: { vitd: true, vitdTime: '08:00', nextFeed: true } }, T1)).status, 200)
  check('only the token hash is stored', store.subs.has(tokenHash(T1)) && !store.subs.has(T1))
  equal('vitamin D schedule created in the device time zone', scheduler.calls.pop(), ['vitd', 1, true, '08:00', 'Europe/Paris'])
  await push({ action: 'update', prefs: { vitd: true, vitdTime: '08:00' } }, T1)
  equal('unchanged reminder: no reschedule', scheduler.calls.length, 0)
  await push({ action: 'update', prefs: { vitdTime: '09:30' } }, T1)
  equal('new reminder time: rescheduled', scheduler.calls.pop(), ['vitd', 1, true, '09:30', 'Europe/Paris'])
  equal('invalid time ignored', (await push({ action: 'update', prefs: { vitdTime: '25:00' } }, T1), store.subs.get(tokenHash(T1)).vitdTime), '09:30')

  // vitamin D at fire time, in the device's time zone (22:30 UTC is already tomorrow in Paris)
  const late = Date.parse('2026-10-20T22:30:00Z')
  equal('local date near midnight', localParts(late, 'Europe/Paris'), { date: '2026-10-21', time: '00:30' })
  let r = await handleFire({ kind: 'vitd', subId: 1 }, deps, late)
  equal('reminder sent when not given', [r.body.sent, sender.sent.pop().body], [1, "C'est l'heure de la vitamine D."])
  await push({ action: 'update', vitdGivenDate: '2026-10-21' }, T1)
  equal('no reminder once given today (local date)', (await handleFire({ kind: 'vitd', subId: 1 }, deps, late)).body, { skipped: 'given' })
  await push({ action: 'update', vitdGivenDate: '2026-10-20' }, T1)
  equal('given yesterday does not count', (await handleFire({ kind: 'vitd', subId: 1 }, deps, late)).body.sent, 1)
  sender.sent.length = 0

  // next bottle (alone): scheduled, rescheduled with cancel, stale deliveries skipped
  const now = Date.parse('2026-10-20T10:00:00Z')
  await handlePush({ body: { action: 'update', lastFeedAt: now - 3600e3, nextFeedAt: now + 7200e3 }, token: T1 }, deps, now)
  const first = scheduler.calls.pop()
  equal('next bottle scheduled at the expected time', [first[0], first[2], first[3]], ['next', { subId: 1, lastFeedAt: now - 3600e3 }, now + 7200e3])
  await handlePush({ body: { action: 'update', lastFeedAt: now, nextFeedAt: now + 10800e3 }, token: T1 }, deps, now)
  equal('a newer bottle cancels the old message', scheduler.calls.slice(-2).map((c) => c[0]), ['cancel', 'next'])
  equal('old delivery is ignored', (await handleFire({ kind: 'next', subId: 1, lastFeedAt: now - 3600e3 }, deps, now)).body, { skipped: 'stale' })
  r = await handleFire({ kind: 'next', subId: 1, lastFeedAt: now }, deps, now)
  equal('current delivery notifies with local time', sender.sent.pop().body, 'Le prochain biberon est prévu vers 15:00.')

  // family: shared "next bottle", vitamin D given on the other phone, partner notifications
  const code = newCode()
  store.families.set(hashCode(code), { id: 7, vitdGiven: new Set(), lastFeedAt: 0, next: null })
  await push({ action: 'update', familyCode: undefined, prefs: { partner: true } }, T1, code)
  await push({ action: 'subscribe', subscription: subscription(2), lang: 'en', unit: 'oz', tz: 'America/New_York', prefs: { partner: true, nextFeed: true, vitd: true } }, T2, code)
  await push({ action: 'subscribe', subscription: subscription('gone'), prefs: { partner: true } }, T3, code)
  equal('phones linked to the family by its code', [...store.subs.values()].map((s) => s.familyId), [7, 7, 7])
  store.families.get(hashCode(code)).vitdGiven.add('2026-10-20')
  equal('given on the other phone: no reminder', (await handleFire({ kind: 'vitd', subId: 2 }, deps, now)).body, { skipped: 'given' })
  await handlePush({ body: { action: 'update', lastFeedAt: now, nextFeedAt: now + 7200e3 }, token: T2 }, deps, now)
  equal('family next bottle is one shared message', scheduler.calls.pop()[2], { familyId: 7, lastFeedAt: now })
  store.families.get(hashCode(code)).lastFeedAt = now + 60e3
  equal('a newer family bottle (even unsynced here) skips it', (await handleFire({ kind: 'next', familyId: 7, lastFeedAt: now }, deps, now)).body, { skipped: 'newer bottle' })
  store.families.get(hashCode(code)).lastFeedAt = now
  r = await handleFire({ kind: 'next', familyId: 7, lastFeedAt: now }, deps, now)
  equal('family next bottle goes to every opted-in phone', sender.sent.splice(0).map((s) => s.body), ['Le prochain biberon est prévu vers 14:00.', 'The next bottle is due around 08:00.'])

  const feed = (id, ml, by, ago = 0) => ({ kind: 'feed', key: id, deleted: false, updatedAt: now - ago, data: { id, date: '2026-10-20', ml, time: '2026-10-20T09:15:00.000Z', by } })
  let n = await notifyPartners({ familyId: 7, inserted: [feed('a', 120, 'Maman')], senderHash: tokenHash(T1) }, deps, now)
  equal('partner notified, sender not', sender.sent.map((s) => [s.to, s.title, s.body]), [['https://push.example/2', 'Maman added a bottle', '4.1 oz at 05:15']])
  check('expired subscription removed', n === 1 && !store.subs.has(tokenHash(T3)))
  sender.sent.length = 0
  equal('a join snapshot is not news', await notifyPartners({ familyId: 7, inserted: ['a', 'b', 'c', 'd'].map((k) => feed(k, 90)), senderHash: null }, deps, now), 0)
  equal('an old bottle (import) is not news', await notifyPartners({ familyId: 7, inserted: [feed('o', 90, 'Papa', 3600e3)], senderHash: null }, deps, now), 0)
  equal('without a name: "The other parent"', (await notifyPartners({ familyId: 7, inserted: [feed('z', 60)], senderHash: tokenHash(T1) }, deps, now), sender.sent.pop().title), 'The other parent added a bottle')

  await push({ action: 'unsubscribe' }, T2)
  check('unsubscribe removes the phone and its schedule', !store.subs.has(tokenHash(T2)) && scheduler.calls.pop()[0] === 'delete-vitd')
  equal('deleted subscription: delivery skipped', (await handleFire({ kind: 'vitd', subId: 2 }, deps, now)).body, { skipped: 'no subscription' })
}
