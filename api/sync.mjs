// Vercel Function: family sharing (see _core.mjs for the protocol).
import { waitUntil } from '@vercel/functions'
import { neonKeySet, verifyAccount } from './_account.mjs'
import { handle } from './_core.mjs'
import { accountStore, pgStore, pushStore } from './_pg.mjs'
import { notifyPartners, tokenHash } from './_push.mjs'
import { webPushSender } from './_webpush.mjs'

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ error: 'bad json' }, { status: 400 }) }
  try {
    // Vercel puts the client address first in x-forwarded-for
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    // a signed-in phone is found by its account's household; older apps and signed-out phones by their code
    let familyId
    if (request.headers.get('authorization')) {
      const userId = await verifyAccount(request.headers.get('authorization'), neonKeySet())
      if (!userId) return Response.json({ error: 'bad token' }, { status: 401 })
      familyId = await accountStore.memberFamily(userId)
      if (!familyId) return Response.json({ error: 'no household' }, { status: 409 })
    }
    const r = await handle({ body, code: request.headers.get('x-family-code'), ip, familyId }, pgStore)
    if (r.inserted && r.inserted.length) {
      // tell the other parent about new bottles, after responding (a push failure never fails a sync)
      const device = request.headers.get('x-device-token')
      waitUntil(
        notifyPartners({ familyId: r.familyId, inserted: r.inserted, senderHash: device ? tokenHash(device) : null }, { store: pushStore, sender: webPushSender })
          .catch((e) => console.error('partner push failed', e)),
      )
    }
    return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('sync failed', e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
