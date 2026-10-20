// QStash scheduling for push notifications. Only production creates real schedules and messages (previews
// and local runs share the database, and must not send reminders to real phones); elsewhere it is a no-op.
import { Client } from '@upstash/qstash'

// always the production endpoint: a schedule must never point at a preview URL that will disappear
const FIRE_URL = 'https://suivi-lait.vercel.app/api/push-fire'
const live = () => process.env.VERCEL_ENV === 'production' && !!process.env.QSTASH_TOKEN
let client
const qstash = () => (client ||= new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL }))

export const qstashScheduler = {
  // daily at the device's reminder time, in its time zone
  async upsertVitd(sub) {
    if (!live()) return
    if (!sub.vitd) return this.deleteVitd(sub.id)
    const [h, m] = sub.vitdTime.split(':').map(Number)
    await qstash().schedules.create({
      scheduleId: 'vitd-' + sub.id,
      destination: FIRE_URL,
      cron: `CRON_TZ=${sub.tz} ${m} ${h} * * *`,
      body: JSON.stringify({ kind: 'vitd', subId: sub.id }),
      headers: { 'Content-Type': 'application/json' },
      retries: 2,
    })
  },
  async deleteVitd(subId) {
    if (!live()) return
    await qstash().schedules.delete('vitd-' + subId).catch(() => {}) // may not exist
  },
  // one message at the expected time of the next bottle; returns its id (to cancel it when rescheduled)
  async scheduleNext(payload, atMs) {
    if (!live()) return null
    const r = await qstash().publishJSON({ url: FIRE_URL, body: { kind: 'next', ...payload }, notBefore: Math.ceil(atMs / 1000), retries: 2 })
    return r.messageId
  },
  async cancel(msgId) {
    if (!live() || !msgId) return
    await qstash().messages.delete(msgId).catch(() => {}) // already delivered or gone: the fire check covers it
  },
}
