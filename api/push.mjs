// Vercel Function: push subscription and state (see _push.mjs).
import { handlePush } from './_push.mjs'
import { pgStore, pushStore } from './_pg.mjs'
import { qstashScheduler } from './_qstash.mjs'
import { createHash } from 'node:crypto'

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ error: 'bad json' }, { status: 400 }) }
  try {
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    if (!(await pgStore.hit('push:' + createHash('sha256').update(ip).digest('hex').slice(0, 32), 300, 600))) {
      return Response.json({ error: 'too many requests' }, { status: 429 })
    }
    const familyCode = request.headers.get('x-family-code')
    const r = await handlePush(
      { body, token: request.headers.get('x-device-token'), familyCode: familyCode === null ? undefined : familyCode },
      { store: pushStore, scheduler: qstashScheduler, publicKey: process.env.VAPID_PUBLIC_KEY },
    )
    return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('push failed', e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
