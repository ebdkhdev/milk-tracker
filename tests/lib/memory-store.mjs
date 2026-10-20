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
    async deleteFamily(ref) { return families.delete(ref.id || ref.hash) },
    // families are keyed by code hash; an account-made family uses its id as key (ids are those keys here)
    async sync(ref, since, changes, limit) {
      const hash = ref.id || ref.hash
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
  // a family the test did not declare (created in the browser) starts empty
  const fam = (id) => [...families.values()].find((f) => f.id === id) || families.set('id:' + id, { id, vitdGiven: new Set(), lastFeedAt: 0, next: null }).get('id:' + id)
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

// In-memory accounts and households (same interface as accountStore in api/_pg.mjs). `users` is filled by the
// test: users.set(id, { id, email, emailVerified, name }). `families` is the sync store's map, so a household
// created here can sync through memoryStore with ref { id }.
export function memoryAccountStore(syncStore) {
  const users = new Map(), members = new Map(), invites = new Map(), viaAccount = new Set()
  let nextInvite = 0, nextFamily = 0
  const families = syncStore.families
  return {
    users, members, invites,
    async getUser(id) { return users.get(id) || null },
    // like the ON DELETE CASCADE of family_members: a deleted family has no members
    async memberFamily(id) { const f = members.get(id); return f !== undefined && families.has(f) ? f : null },
    async addMember(id, familyId) { members.set(id, familyId) },
    async removeMember(id) { members.delete(id) },
    async familyMembers(familyId) { return [...members].filter(([, f]) => f === familyId).map(([id]) => ({ userId: id, email: users.get(id).email, name: users.get(id).name })) },
    async familyIdByHash(hash) { return families.has(hash) ? hash : null },
    async createAccountFamily() { const id = 'acct-family-' + ++nextFamily; families.set(id, new Map()); viaAccount.add(id); return id },
    async deleteFamilyIfOrphan(id) { if (viaAccount.has(id) && ![...members.values()].includes(id)) families.delete(id) },
    async upsertInvite(familyId, email, by, expiresAt) {
      const cur = [...invites.values()].find((i) => i.familyId === familyId && i.email === email)
      if (cur) Object.assign(cur, { by, expiresAt: +expiresAt })
      else { const id = ++nextInvite; invites.set(id, { id, familyId, email, by, expiresAt: +expiresAt }) }
    },
    async getInvite(id) { return invites.get(id) || null },
    async deleteInvite(id) { invites.delete(id) },
    async sentInvites(familyId, now) { return [...invites.values()].filter((i) => i.familyId === familyId && i.expiresAt > now) },
    async invitesFor(email, now) {
      return [...invites.values()].filter((i) => i.email === email && i.expiresAt > now).map((i) => ({ ...i, fromName: users.get(i.by)?.name, fromEmail: users.get(i.by)?.email }))
    },
  }
}
