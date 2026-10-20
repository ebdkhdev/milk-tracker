// Vercel Function: family sharing (see _core.mjs for the protocol).
import { handle } from './_core.mjs'
import { pgStore } from './_pg.mjs'

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ error: 'bad json' }, { status: 400 }) }
  try {
    const r = await handle({ body, code: request.headers.get('x-family-code') }, pgStore)
    return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('sync failed', e)
    return Response.json({ error: 'server error' }, { status: 500 })
  }
}
