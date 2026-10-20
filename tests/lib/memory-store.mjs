// In-memory store with the same semantics as api/_pg.mjs (last write wins on updatedAt, a new sequence number
// per accepted write, pull after a cursor), for the end-to-end tests. Never touches the real database.
export function memoryStore() {
  const families = new Map() // hash -> Map("kind:key" -> record)
  let seq = 0
  return {
    // test helpers: make the API fail (offline phone) or inspect a family
    down: false,
    families,
    hits: new Map(),
    async hit(bucket, max, windowSeconds) {
      const now = Date.now()
      const h = this.hits.get(bucket)
      if (!h || h.reset < now) { this.hits.set(bucket, { count: 1, reset: now + windowSeconds * 1000 }); return 1 <= max }
      h.count++
      return h.count <= max
    },
    async createFamily(hash) { families.set(hash, new Map()) },
    async deleteFamily(hash) { return families.delete(hash) },
    async sync(hash, since, changes, limit) {
      const fam = families.get(hash)
      if (!fam) return null
      const inserted = []
      for (const c of changes) {
        const k = c.kind + ':' + c.key
        const cur = fam.get(k)
        if (!cur) inserted.push(c)
        if (!cur || cur.updatedAt < c.updatedAt) fam.set(k, { ...c, seq: ++seq })
      }
      const rows = [...fam.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq)
      const list = rows.slice(0, limit)
      return {
        familyId: hash,
        inserted,
        cursor: list.length ? list[list.length - 1].seq : since,
        more: rows.length > limit,
        changes: list.map(({ kind, key, data, deleted, updatedAt }) => ({ kind, key, data, deleted, updatedAt })),
      }
    },
  }
}

// In-memory push store (same interface as pushStore in api/_pg.mjs). Families are declared by the test:
// families.set(familyHash, { id, vitdGiven: Set of dates, lastFeedAt, next: null })
export function memoryPushStore() {
  const subs = new Map() // hash -> sub
  const families = new Map()
  let nextId = 0
  const byId = (id) => [...subs.values()].find((s) => s.id === id) || null
  const fam = (id) => [...families.values()].find((f) => f.id === id)
  const defaults = { familyId: null, lang: 'fr', unit: 'ml', tz: 'Europe/Paris', name: null, vitd: false, vitdTime: '08:00', nextFeed: false, partner: false, vitdGivenDate: null, next: null }
  return {
    subs,
    families,
    async familyId(familyHash) { const f = families.get(familyHash); return f ? f.id : null },
    async getSub(hash) { return subs.get(hash) || null },
    async getSubById(id) { return byId(id) },
    async upsertSub(hash, fields) {
      const cur = subs.get(hash) || { id: ++nextId, hash, ...defaults }
      const sub = { ...cur, ...fields }
      subs.set(hash, sub)
      return sub
    },
    async updateSub(hash, fields) { const sub = { ...subs.get(hash), ...fields }; subs.set(hash, sub); return sub },
    async deleteSub(hash) { subs.delete(hash) },
    async deleteSubById(id) { const s = byId(id); if (s) subs.delete(s.hash) },
    async familySubs(familyId) { return [...subs.values()].filter((s) => s.familyId === familyId) },
    async getNext(scope) { return (scope.familyId ? fam(scope.familyId) : byId(scope.subId))?.next || null },
    async setNext(scope, v) { (scope.familyId ? fam(scope.familyId) : byId(scope.subId)).next = v },
    async familyVitdGiven(familyId, date) { return !!fam(familyId)?.vitdGiven.has(date) },
    async familyLastFeedAt(familyId) { return fam(familyId)?.lastFeedAt || 0 },
  }
}

// Records what would be scheduled on QStash.
export function fakeScheduler() {
  let n = 0
  return {
    calls: [],
    async upsertVitd(sub) { this.calls.push(['vitd', sub.id, sub.vitd, sub.vitdTime, sub.tz]) },
    async deleteVitd(subId) { this.calls.push(['delete-vitd', subId]) },
    async scheduleNext(payload, at) { const id = 'msg' + ++n; this.calls.push(['next', id, payload, at]); return id },
    async cancel(id) { this.calls.push(['cancel', id]) },
  }
}

// Records what would be pushed; endpoints in `gone` answer like an expired subscription.
export function fakeSender(gone = new Set()) {
  return {
    sent: [],
    async send(sub, payload) {
      if (gone.has(sub.endpoint)) return 'gone'
      this.sent.push({ to: sub.endpoint, ...payload })
      return 'ok'
    },
  }
}
