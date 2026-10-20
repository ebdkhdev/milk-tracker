// Sync protocol shared by the Vercel function (Postgres store) and the tests (in-memory store).
//
// POST /api/sync { action: "create" }                          -> { code }
// POST /api/sync { action: "sync", since, changes }            -> { cursor, changes, more }
//   header X-Family-Code: the family code (never in the URL)
//
// A change is { kind: "feed" | "daily" | "baby", key, data, deleted, updatedAt (ms) }. The store keeps, per
// family and (kind, key), the change with the latest updatedAt (last write wins, deletions kept as tombstones),
// each with a per-write sequence number; a client pulls everything after the sequence it last saw.
import { createHash, randomBytes } from 'node:crypto'

export const MAX_CHANGES = 500 // per request; clients send their queue in chunks
export const MAX_PULL = 1000 // per response; `more` tells the client to ask again
const MAX_DATA_BYTES = 2048
const CLOCK_SKEW_MS = 5 * 60 * 1000 // a phone clock ahead of the server can't win conflicts forever
const KEY_RE = { feed: /^[\w.-]{1,64}$/, daily: /^\d{4}-\d{2}-\d{2}$/, baby: /^baby$/ }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I: easy to read aloud and type

// 26 characters from 16 random bytes (128 bits), shown in groups of four.
export function newCode() {
  const bytes = randomBytes(16)
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g).join('-')
}
export const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const hashCode = (code) => createHash('sha256').update(normalizeCode(code)).digest('hex')

// Validated, clamped and de-duplicated changes, or a string describing the problem.
export function validateChanges(changes, now) {
  if (!Array.isArray(changes)) return 'changes must be an array'
  if (changes.length > MAX_CHANGES) return 'too many changes'
  const byKey = new Map()
  for (const c of changes) {
    if (!c || !KEY_RE[c.kind] || typeof c.key !== 'string' || !KEY_RE[c.kind].test(c.key)) return 'bad change key'
    const updatedAt = Math.min(Math.floor(Number(c.updatedAt)), now + CLOCK_SKEW_MS)
    if (!(updatedAt >= 0)) return 'bad updatedAt'
    const deleted = !!c.deleted
    const data = deleted ? null : c.data
    if (!deleted && (!data || typeof data !== 'object' || Array.isArray(data))) return 'bad data'
    if (data && JSON.stringify(data).length > MAX_DATA_BYTES) return 'data too large'
    const k = c.kind + ':' + c.key
    const prev = byKey.get(k)
    if (!prev || prev.updatedAt < updatedAt) byKey.set(k, { kind: c.kind, key: c.key, data, deleted, updatedAt })
  }
  return [...byKey.values()]
}

// store: { createFamily(hash), sync(hash, since, changes, limit) -> { cursor, changes, more } | null }
export async function handle({ body, code }, store, now = Date.now()) {
  if (!body || typeof body !== 'object') return { status: 400, body: { error: 'bad request' } }
  if (body.action === 'create') {
    const newFamilyCode = newCode()
    await store.createFamily(hashCode(newFamilyCode))
    return { status: 200, body: { code: newFamilyCode } }
  }
  if (body.action === 'sync') {
    if (normalizeCode(code).length !== 26) return { status: 401, body: { error: 'missing family code' } }
    const since = Math.max(0, Math.floor(Number(body.since) || 0))
    const changes = validateChanges(body.changes || [], now)
    if (typeof changes === 'string') return { status: 400, body: { error: changes } }
    const result = await store.sync(hashCode(code), since, changes, MAX_PULL)
    if (!result) return { status: 404, body: { error: 'unknown family' } }
    return { status: 200, body: result }
  }
  return { status: 400, body: { error: 'unknown action' } }
}
