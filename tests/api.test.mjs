// Server protocol (api/_core.mjs) over the in-memory store: codes, validation, last write wins, limits.
import { LIMITS, handle, hashCode, newCode, normalizeCode } from '../api/_core.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { memoryStore } from './lib/memory-store.mjs'

export async function run() {
  suite('API: sync protocol')
  const store = memoryStore()
  const call = (body, code, ip = '1.2.3.4') => handle({ body, code, ip }, store)

  const codes = new Set(Array.from({ length: 200 }, newCode))
  check('codes: 26 readable characters, no collisions in 200', codes.size === 200 && [...codes].every((c) => /^([A-Z2-9]{4}-){6}[A-Z2-9]{2}$/.test(c)))
  equal('codes are case- and separator-insensitive', hashCode('abcd efgh-ijkm'), hashCode('ABCDEFGHIJKM'))
  equal('normalize', normalizeCode(' ab-c d '), 'ABCD')

  const { body: { code } } = await call({ action: 'create' })
  check('the store keeps the hash, never the code', store.families.has(hashCode(code)) && !store.families.has(code))
  const feed = (ml, updatedAt, extra = {}) => ({ kind: 'feed', key: 'f1', data: { id: 'f1', date: '2026-10-20', ml, time: '2026-10-20T08:00:00.000Z' }, deleted: false, updatedAt, ...extra })
  let r = await call({ action: 'sync', since: 0, changes: [feed(100, 1000)] }, code)
  equal('push accepted', [r.status, r.body.changes.length, r.body.cursor > 0], [200, 1, true])
  r = await call({ action: 'sync', since: 0, changes: [feed(50, 500)] }, code)
  equal('an older write loses', r.body.changes[0].data.ml, 100)
  const cursor = r.body.cursor
  r = await call({ action: 'sync', since: cursor, changes: [{ kind: 'feed', key: 'f1', data: null, deleted: true, updatedAt: 2000 }] }, code)
  equal('a newer deletion wins and is pulled', [r.body.changes.length, r.body.changes[0].deleted], [1, true])
  r = await call({ action: 'sync', since: 0, changes: [feed(70, Date.now() + 3600 * 1000, { key: 'f2', data: { id: 'f2', date: '2026-10-20', ml: 70, time: '2026-10-20T09:00:00.000Z' } })] }, code)
  check('a clock far ahead is clamped to server time + 5 min', r.body.changes.find((c) => c.key === 'f2').updatedAt <= Date.now() + 5 * 60 * 1000)

  equal('bad key refused', (await call({ action: 'sync', since: 0, changes: [{ kind: 'feed', key: 'a b', data: {}, updatedAt: 1 }] }, code)).status, 400)
  equal('unknown kind refused', (await call({ action: 'sync', since: 0, changes: [{ kind: 'x', key: 'a', data: {}, updatedAt: 1 }] }, code)).status, 400)
  equal('oversized record refused', (await call({ action: 'sync', since: 0, changes: [feed(1, 1, { data: { id: 'f1', pad: 'x'.repeat(3000) } })] }, code)).status, 400)
  equal('too many changes refused', (await call({ action: 'sync', since: 0, changes: Array.from({ length: 501 }, (_, i) => feed(1, 1, { key: 'k' + i })) }, code)).status, 400)
  equal('missing code', (await call({ action: 'sync', since: 0, changes: [] })).status, 401)
  equal('unknown family', (await call({ action: 'sync', since: 0, changes: [] }, newCode())).status, 404)
  equal('unknown action', (await call({ action: 'nope' })).status, 400)

  equal('delete', (await call({ action: 'delete' }, code)).body, { deleted: true })
  equal('deleted family is gone', (await call({ action: 'sync', since: 0, changes: [] }, code)).status, 404)

  // limits: creations per IP, then every request per IP
  const ip = '9.9.9.9'
  const created = []
  for (let i = 0; i <= LIMITS.create[0]; i++) created.push((await call({ action: 'create' }, undefined, ip)).status)
  equal(`at most ${LIMITS.create[0]} families per hour per IP`, [created.filter((s) => s === 200).length, created[created.length - 1]], [LIMITS.create[0], 429])
  equal('another IP can still create', (await call({ action: 'create' }, undefined, '8.8.8.8')).status, 200)
  check('IPs are only stored hashed', [...store.hits.keys()].every((k) => !k.includes('9.9.9.9') && !k.includes('8.8.8.8')))
}
