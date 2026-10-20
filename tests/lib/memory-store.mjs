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
      for (const c of changes) {
        const k = c.kind + ':' + c.key
        const cur = fam.get(k)
        if (!cur || cur.updatedAt < c.updatedAt) fam.set(k, { ...c, seq: ++seq })
      }
      const rows = [...fam.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq)
      const list = rows.slice(0, limit)
      return {
        cursor: list.length ? list[list.length - 1].seq : since,
        more: rows.length > limit,
        changes: list.map(({ kind, key, data, deleted, updatedAt }) => ({ kind, key, data, deleted, updatedAt })),
      }
    },
  }
}
