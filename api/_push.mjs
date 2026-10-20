// Push notifications (app closed): protocol, scheduling decisions and texts. Pure logic over injected
// dependencies, so the tests run it with fakes:
//   store     — push rows and family facts (api/_pg.mjs pushStore, tests/lib/memory-store.mjs)
//   scheduler — QStash: daily vitamin D schedule per device, one-off "next bottle" messages (api/_qstash.mjs)
//   sender    — Web Push (api/_webpush.mjs); send() resolves 'ok' or 'gone' (subscription expired)
//
// iOS revokes a subscription that receives pushes without a notification, so nothing is filtered on the
// phone: every decision ("given already?", "a newer bottle since?") is taken here, at fire time.
import { createHash, randomBytes } from 'node:crypto'
import { hashCode, normalizeCode } from './_core.mjs'

const TEXT = {
  fr: {
    vitdTitle: 'Vitamine D', vitdBody: "C'est l'heure de la vitamine D.",
    nextTitle: 'Prochain biberon', nextBody: 'Le prochain biberon est prévu vers {time}.',
    testTitle: 'Milk Tracker', testBody: 'Les notifications fonctionnent sur ce téléphone.',
    partnerTitle: '{name} a ajouté un biberon', partnerTitleBaby: '{name} a ajouté un biberon pour {baby}', partnerBody: '{amount} à {time}', partnerName: "L'autre parent",
  },
  en: {
    vitdTitle: 'Vitamin D', vitdBody: 'Time for vitamin D.',
    nextTitle: 'Next bottle', nextBody: 'The next bottle is due around {time}.',
    testTitle: 'Milk Tracker', testBody: 'Notifications work on this phone.',
    partnerTitle: '{name} added a bottle', partnerTitleBaby: '{name} added a bottle for {baby}', partnerBody: '{amount} at {time}', partnerName: 'The other parent',
  },
  ar: {
    vitdTitle: 'فيتامين د', vitdBody: 'حان وقت فيتامين د.',
    nextTitle: 'الرضعة التالية', nextBody: 'الرضعة التالية متوقعة نحو {time}.',
    testTitle: 'Milk Tracker', testBody: 'الإشعارات تعمل على هذا الهاتف.',
    partnerTitle: '{name} أضاف رضعة', partnerTitleBaby: '{name} أضاف رضعة لـ{baby}', partnerBody: '{amount} في {time}', partnerName: 'الوالد الآخر',
  },
}
const UNIT = { fr: { ml: 'ml', oz: 'oz' }, en: { ml: 'ml', oz: 'oz' }, ar: { ml: 'مل', oz: 'أونصة' } }
const ML_PER_OZ = 29.5735
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m))
const text = (lang) => TEXT[lang] || TEXT.fr

// Local date (YYYY-MM-DD) and time (HH:MM) of an instant in a device's time zone.
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

const amountText = (ml, sub) => {
  const lang = UNIT[sub.lang] ? sub.lang : 'fr'
  return sub.unit === 'oz' ? Math.round((ml / ML_PER_OZ) * 10) / 10 + ' ' + UNIT[lang].oz : Math.round(ml) + ' ' + UNIT[lang].ml
}

export const tokenHash = (token) => createHash('sha256').update(String(token || '')).digest('hex')
export const newDeviceToken = () => randomBytes(24).toString('base64url')

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const LANGS = ['fr', 'en', 'ar']
function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return typeof tz === 'string' && tz.length < 64 } catch (e) { return false }
}

// What a device tells the server about itself. Unknown or invalid fields are ignored.
function readDevice(body) {
  const d = {}
  if (LANGS.includes(body.lang)) d.lang = body.lang
  if (body.unit === 'ml' || body.unit === 'oz') d.unit = body.unit
  if (validTz(body.tz)) d.tz = body.tz
  if (typeof body.name === 'string') d.name = body.name.trim().slice(0, 20)
  const p = body.prefs
  if (p && typeof p === 'object') {
    if (typeof p.vitd === 'boolean') d.vitd = p.vitd
    if (typeof p.vitdTime === 'string' && TIME_RE.test(p.vitdTime)) d.vitdTime = p.vitdTime
    if (typeof p.nextFeed === 'boolean') d.nextFeed = p.nextFeed
    if (typeof p.partner === 'boolean') d.partner = p.partner
  }
  if (body.vitdGivenDate === null || (typeof body.vitdGivenDate === 'string' && DAY_RE.test(body.vitdGivenDate))) d.vitdGivenDate = body.vitdGivenDate
  return d
}
function readSubscription(s) {
  if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return null
  const k = s.keys || {}
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return null
  return { endpoint: s.endpoint, p256dh: k.p256dh, auth: k.auth }
}

// POST /api/push, header X-Device-Token (a random secret the phone keeps; only its hash is stored).
//   { action: "key" }                                                     -> { publicKey }
//   { action: "subscribe", subscription, prefs, lang, unit, tz, name, familyCode? }
//   { action: "update", prefs?, lang?, unit?, tz?, name?, familyCode?, vitdGivenDate?, lastFeedAt?, nextFeedAt? }
//   { action: "unsubscribe" }
//   { action: "test" }                                                    -> a notification to this phone now
export async function handlePush({ body, token, familyCode }, deps, now = Date.now()) {
  const { store, scheduler } = deps
  if (!body || typeof body !== 'object') return { status: 400, body: { error: 'bad request' } }
  if (body.action === 'key') return { status: 200, body: { publicKey: deps.publicKey } }
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { status: 401, body: { error: 'missing device token' } }
  const hash = tokenHash(token)

  if (body.action === 'test') {
    const sub = await store.getSub(hash)
    if (!sub) return { status: 404, body: { error: 'not subscribed' } }
    const t = text(sub.lang)
    const sent = await sendAll([sub], () => ({ title: t.testTitle, body: t.testBody, tag: 'test' }), deps)
    return { status: 200, body: { sent } }
  }

  if (body.action === 'unsubscribe') {
    const sub = await store.getSub(hash)
    if (sub) {
      await scheduler.deleteVitd(sub.id)
      await store.deleteSub(hash)
    }
    return { status: 200, body: { ok: true } }
  }

  // family membership is proven by the family code, sent like for /api/sync (never stored in clear)
  let familyId
  if (familyCode !== undefined) familyId = normalizeCode(familyCode).length === 26 ? await store.familyId(hashCode(familyCode)) : null

  if (body.action === 'subscribe') {
    const subscription = readSubscription(body.subscription)
    if (!subscription) return { status: 400, body: { error: 'bad subscription' } }
    const sub = await store.upsertSub(hash, { ...subscription, ...readDevice(body), ...(familyId !== undefined ? { familyId } : {}) })
    await scheduler.upsertVitd(sub)
    return { status: 200, body: { ok: true } }
  }

  if (body.action === 'update') {
    const existing = await store.getSub(hash)
    if (!existing) return { status: 404, body: { error: 'not subscribed' } }
    const sub = await store.updateSub(hash, { ...readDevice(body), ...(familyId !== undefined ? { familyId } : {}) })
    if (['vitd', 'vitdTime', 'tz'].some((k) => sub[k] !== existing[k])) await scheduler.upsertVitd(sub)
    // the expected next bottle: for a family it is shared (one message for every opted-in phone)
    const last = Number(body.lastFeedAt), next = Number(body.nextFeedAt)
    if (last > 0 && next > now && next - now < 24 * 3600 * 1000) {
      const scope = sub.familyId ? { familyId: sub.familyId } : { subId: sub.id }
      // a phone that hasn't synced the latest family bottle yet must not replace the family's schedule
      if (scope.familyId && last < (await store.familyLastFeedAt(scope.familyId))) return { status: 200, body: { ok: true } }
      const current = await store.getNext(scope)
      if (!current || current.lastFeedAt !== last || current.nextFeedAt !== next) {
        if (current && current.msgId) await scheduler.cancel(current.msgId)
        const msgId = await scheduler.scheduleNext({ ...scope, lastFeedAt: last }, next)
        await store.setNext(scope, { lastFeedAt: last, nextFeedAt: next, msgId })
      }
    }
    return { status: 200, body: { ok: true } }
  }
  return { status: 400, body: { error: 'unknown action' } }
}

// Sends to each subscription; expired ones are removed.
async function sendAll(subs, build, deps) {
  let sent = 0
  for (const sub of subs) {
    const payload = build(sub)
    const r = await deps.sender.send(sub, payload).catch((e) => { console.error('push failed', e && e.statusCode); return 'error' })
    if (r === 'gone') await deps.store.deleteSubById(sub.id)
    if (r === 'ok') sent++
  }
  return sent
}

// A QStash delivery (signature already verified): { kind: "vitd", subId } or { kind: "next", subId | familyId, lastFeedAt }.
export async function handleFire(payload, deps, now = Date.now()) {
  const { store } = deps
  if (!payload || typeof payload !== 'object') return { status: 400, body: { error: 'bad payload' } }

  if (payload.kind === 'vitd') {
    const sub = await store.getSubById(Number(payload.subId))
    if (!sub || !sub.vitd) return { status: 200, body: { skipped: 'no subscription' } }
    const today = localParts(now, sub.tz).date
    // given today on this phone, or (in a family) on any phone of the family
    const given = sub.vitdGivenDate === today || (sub.familyId && (await store.familyVitdGiven(sub.familyId, today)))
    if (given) return { status: 200, body: { skipped: 'given' } }
    const t = text(sub.lang)
    const sent = await sendAll([sub], () => ({ title: t.vitdTitle, body: t.vitdBody, tag: 'vitd-reminder' }), deps)
    return { status: 200, body: { sent } }
  }

  if (payload.kind === 'next') {
    const scope = payload.familyId ? { familyId: Number(payload.familyId) } : { subId: Number(payload.subId) }
    const current = await store.getNext(scope)
    // stale: a newer bottle rescheduled it (a missed cancel is harmless)
    if (!current || current.lastFeedAt !== Number(payload.lastFeedAt)) return { status: 200, body: { skipped: 'stale' } }
    if (scope.familyId) {
      // A bottle logged since, possibly on a phone without notifications: reschedule from it with the same
      // interval instead of dropping the reminder (always later than this one, so it cannot loop).
      const latest = await store.familyLastFeedAt(scope.familyId)
      if (latest > current.lastFeedAt) {
        const at = latest + (current.nextFeedAt - current.lastFeedAt)
        if (at <= now) return { status: 200, body: { skipped: 'newer bottle' } }
        const msgId = await deps.scheduler.scheduleNext({ ...scope, lastFeedAt: latest }, at)
        await store.setNext(scope, { lastFeedAt: latest, nextFeedAt: at, msgId })
        return { status: 200, body: { rescheduled: at } }
      }
    }
    const subs = scope.familyId ? await store.familySubs(scope.familyId) : [await store.getSubById(scope.subId)].filter(Boolean)
    const sent = await sendAll(subs.filter((s) => s.nextFeed), (sub) => {
      const t = text(sub.lang)
      return { title: t.nextTitle, body: fill(t.nextBody, { time: localParts(current.nextFeedAt, sub.tz).time }), tag: 'next-feed' }
    }, deps)
    return { status: 200, body: { sent } }
  }
  return { status: 400, body: { error: 'unknown kind' } }
}

// After a sync: tell the family's other phones about bottles just added (not edits, undo or old imports).
export async function notifyPartners({ familyId, inserted, senderHash }, deps, now = Date.now()) {
  const fresh = inserted.filter((c) => (c.kind === 'feed' || c.kind === 'bfeed') && !c.deleted && now - c.updatedAt < 15 * 60 * 1000)
  if (!fresh.length || fresh.length > 3) return 0 // a join snapshot or an import is not news
  const subs = (await deps.store.familySubs(familyId)).filter((s) => s.partner && s.hash !== senderHash)
  if (!subs.length) return 0
  const names = deps.store.familyBabyNames ? await deps.store.familyBabyNames(familyId) : {}
  let sent = 0
  for (const c of fresh) {
    const f = c.data
    sent += await sendAll(subs, (sub) => {
      const t = text(sub.lang)
      return {
        title: names[f.babyId || 'b1']
          ? fill(t.partnerTitleBaby, { name: f.by || t.partnerName, baby: names[f.babyId || 'b1'] })
          : fill(t.partnerTitle, { name: f.by || t.partnerName }),
        body: fill(t.partnerBody, { amount: amountText(Number(f.ml), sub), time: localParts(Date.parse(f.time), sub.tz).time }),
        tag: 'feed-' + f.id,
      }
    }, deps)
  }
  return sent
}
