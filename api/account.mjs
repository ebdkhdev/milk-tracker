// Vercel Function: accounts and households (see _account.mjs).
import { createHash } from 'node:crypto'
import { handleAccount, neonKeySet, verifyAccount } from './_account.mjs'
import { accountStore, pgStore } from './_pg.mjs'

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ error: 'bad json' }, { status: 400 }) }
  try {
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    if (!(await pgStore.hit('account:' + createHash('sha256').update(ip).digest('hex').slice(0, 32), 120, 600))) {
      return Response.json({ error: 'too many requests' }, { status: 429 })
    }
    const userId = await verifyAccount(request.headers.get('authorization'), neonKeySet())
    const r = await handleAccount({ body, userId }, accountStore)
    return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('account failed', e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
