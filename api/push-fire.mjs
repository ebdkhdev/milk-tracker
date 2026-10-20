// Vercel Function called by QStash at reminder time. Only signed QStash requests are accepted.
import { Receiver } from '@upstash/qstash'
import { handleFire } from './_push.mjs'
import { pushStore } from './_pg.mjs'
import { webPushSender } from './_webpush.mjs'

export async function POST(request) {
  const raw = await request.text() // the signature covers the raw body
  try {
    const receiver = new Receiver({ currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY })
    await receiver.verify({ signature: request.headers.get('upstash-signature') || '', body: raw, url: 'https://suivi-lait.vercel.app/api/push-fire', clockTolerance: 30 })
  } catch (e) {
    return Response.json({ error: 'invalid signature' }, { status: 401 })
  }
  try {
    const r = await handleFire(JSON.parse(raw), { store: pushStore, sender: webPushSender })
    return Response.json(r.body, { status: r.status })
  } catch (e) {
    console.error('push fire failed', e)
    return Response.json({ error: 'server error' }, { status: 500 }) // QStash retries
  }
}
