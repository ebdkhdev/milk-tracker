// Vercel Function: Neon Auth on the app's own origin (/auth/* is rewritten here, see vercel.json), so its
// session cookies are first-party: Safari blocks third-party cookies. A plain Vercel rewrite can't be used:
// it adds X-Forwarded-Host with the app's host, which Neon Auth rejects ("Invalid hostname header").
const DROP_REQUEST = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'forwarded'])
const DROP_RESPONSE = new Set(['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'])

export async function proxy(request, base = process.env.NEON_AUTH_BASE_URL) {
  const url = new URL(request.url)
  const path = (url.searchParams.get('__p') || '').replace(/^\/+/, '')
  url.searchParams.delete('__p')
  if (path.split('/').includes('..')) return new Response('bad path', { status: 400 })
  const target = base.replace(/\/$/, '') + '/' + path + (url.search || '')
  const headers = new Headers()
  for (const [k, v] of request.headers) if (!DROP_REQUEST.has(k.toLowerCase()) && !k.toLowerCase().startsWith('x-vercel')) headers.set(k, v)
  const init = { method: request.method, headers, redirect: 'manual' }
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer()
  const upstream = await fetch(target, init)
  const out = new Headers()
  for (const [k, v] of upstream.headers) if (!DROP_RESPONSE.has(k.toLowerCase())) out.set(k, v)
  // cookies belong to the app's origin: drop any Domain naming Neon's host
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c.replace(/;\s*Domain=[^;]*/i, ''))
  out.set('cache-control', 'no-store')
  return new Response(['GET', 'HEAD'].includes(request.method) && upstream.status === 304 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: out })
}

export const GET = (r) => proxy(r)
export const POST = (r) => proxy(r)
export const PUT = (r) => proxy(r)
export const PATCH = (r) => proxy(r)
export const DELETE = (r) => proxy(r)
export const OPTIONS = (r) => proxy(r)
