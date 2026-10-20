// IndexedDB layer. Names must stay as they are: existing users' data lives here. Bump DB_VERSION for any
// schema change and keep earlier versions upgradable in onupgradeneeded.
const DB_NAME = 'suivi-lait-db'
const DB_VERSION = 4
const STORE = 'feeds'
const DAILY_STORE = 'daily'
const OUTBOX = 'outbox' // v3: changes waiting to be sent to the family (sharing only)
const DAYS = 'days' // v4: per-day facts of the babies other than the first ("daily" stays the first baby's)
const EVENTS = 'events' // v4: diapers, sleep and growth measurements, any baby
const FIRST_BABY = 'b1' // records without babyId belong to it (see lib/baby.ts)
const LEGACY_KEY = 'suivi-lait-data-v1'

export type MilkType = 'formula' | 'breast'
// type and note are optional: older records (and users who don't track the type) have neither.
// updatedAt (ms) is stamped on every local write; sharing resolves conflicts with it (last write wins).
// by: name of the parent who added it (sharing), set once on add and kept through edits
// babyId: absent for the first baby (records from before several babies existed stay untouched)
export type Feed = { id: string; date: string; ml: number; time: string; type?: MilkType; note?: string; by?: string; babyId?: string; updatedAt?: number }
export type Daily = { date: string; vitaminD: boolean; vitaminDTime: string | null; updatedAt?: number }
// a Daily for another baby: id = babyId + "|" + date
export type Day = Daily & { id: string; babyId: string }
export type EventRecord = { id: string; babyId?: string; type: string; date: string; time: string; updatedAt?: number; [k: string]: unknown }

// feed/daily/baby: the first baby (as in v2.6+); bfeed/day/profile/event: added in v2.9, ignored by older apps
export type ChangeKind = 'feed' | 'daily' | 'baby' | 'bfeed' | 'day' | 'profile' | 'event'
export type Change = { kind: ChangeKind; key: string; data: object | null; deleted: boolean; updatedAt: number }
type OutboxEntry = Change & { k: string }

let dbPromise: Promise<IDBDatabase> | null = null
// While the device is in a family, every local write also queues a change in the same transaction.
let queueing = false
let queuedListener: () => void = () => {}
export function setQueueing(on: boolean) { queueing = on }
export function onQueued(cb: () => void) { queuedListener = cb }

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB indisponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('by_date', 'date', { unique: false })
      }
      if (!db.objectStoreNames.contains(DAILY_STORE)) {
        db.createObjectStore(DAILY_STORE, { keyPath: 'date' })
      }
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: 'k' })
      }
      if (!db.objectStoreNames.contains(DAYS)) {
        db.createObjectStore(DAYS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(EVENTS)) {
        db.createObjectStore(EVENTS, { keyPath: 'id' }).createIndex('by_date', 'date', { unique: false })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // another tab (or a newer version of the app) needs to upgrade: let it
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => console.warn('IndexedDB upgrade waiting for another tab to close')
  })
  return dbPromise
}

const queueEntry = (c: Change): OutboxEntry => ({ ...c, k: c.kind + ':' + c.key })

// Writes records to one store and, when sharing, the matching changes to the outbox, in one transaction.
function write(storeName: string, op: (store: IDBObjectStore) => Change[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const queue = queueing && storeName !== OUTBOX
        const tx = db.transaction(queue ? [storeName, OUTBOX] : [storeName], 'readwrite')
        const changes = op(tx.objectStore(storeName))
        if (queue) changes.forEach((c) => tx.objectStore(OUTBOX).put(queueEntry(c)))
        tx.oncomplete = () => { if (queue && changes.length) queuedListener(); resolve() }
        tx.onerror = () => reject(tx.error)
      }),
  )
}

function read<R>(storeName: string, op: (store: IDBObjectStore) => IDBRequest): Promise<R> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = op(db.transaction(storeName, 'readonly').objectStore(storeName))
        req.onsuccess = () => resolve(req.result as R)
        req.onerror = () => reject(req.error)
      }),
  )
}

const feedKind = (babyId?: string) => (babyId && babyId !== FIRST_BABY ? 'bfeed' : 'feed')
const feedChange = (f: Feed): Change => ({ kind: feedKind(f.babyId), key: f.id, data: f, deleted: false, updatedAt: f.updatedAt || 0 })
const dailyChange = (d: Daily): Change => ({ kind: 'daily', key: d.date, data: d, deleted: false, updatedAt: d.updatedAt || 0 })
const dayChange = (d: Day): Change => ({ kind: 'day', key: d.id, data: d, deleted: false, updatedAt: d.updatedAt || 0 })
const eventChange = (e: EventRecord): Change => ({ kind: 'event', key: e.id, data: e, deleted: false, updatedAt: e.updatedAt || 0 })

// Every local write is stamped now, so an undo (re-putting a deleted bottle) wins over its deletion.
export const dbAdd = (entry: Feed) => {
  const f = { ...entry, updatedAt: Date.now() }
  return write(STORE, (s) => { s.add(f); return [feedChange(f)] })
}
export const dbPut = (entry: Feed) => {
  const f = { ...entry, updatedAt: Date.now() }
  return write(STORE, (s) => { s.put(f); return [feedChange(f)] })
}
export const dbDelete = (id: string, babyId?: string) =>
  write(STORE, (s) => { s.delete(id); return [{ kind: feedKind(babyId), key: id, data: null, deleted: true, updatedAt: Date.now() }] })
export const dbGetByDate = (date: string) =>
  read<Feed[]>(STORE, (s) => s.index('by_date').getAll(IDBKeyRange.only(date))).then((r) => r || [])
export const dbGetAll = () => read<Feed[]>(STORE, (s) => s.getAll()).then((r) => r || [])

export const dbGetDaily = (date: string) =>
  read<Daily | undefined>(DAILY_STORE, (s) => s.get(date)).then((r) => r || null)
export const dbPutDaily = (record: Daily) => {
  const d = { ...record, updatedAt: Date.now() }
  return write(DAILY_STORE, (s) => { s.put(d); return [dailyChange(d)] })
}
export const dbGetAllDaily = () => read<Daily[]>(DAILY_STORE, (s) => s.getAll()).then((r) => r || [])
export const dbGetAllDays = () => read<Day[]>(DAYS, (s) => s.getAll()).then((r) => r || [])
export const dbPutDay = (record: Day) => {
  const d = { ...record, updatedAt: Date.now() }
  return write(DAYS, (s) => { s.put(d); return [dayChange(d)] })
}
export const dbDeleteDay = (id: string) =>
  write(DAYS, (s) => { s.delete(id); return [{ kind: 'day', key: id, data: null, deleted: true, updatedAt: Date.now() }] })
export const dbGetAllEvents = () => read<EventRecord[]>(EVENTS, (s) => s.getAll()).then((r) => r || [])
export const dbPutEvent = (record: EventRecord) => {
  const e = { ...record, updatedAt: Date.now() }
  return write(EVENTS, (s) => { s.put(e); return [eventChange(e)] })
}
export const dbDeleteEvent = (id: string) =>
  write(EVENTS, (s) => { s.delete(id); return [{ kind: 'event', key: id, data: null, deleted: true, updatedAt: Date.now() }] })

// Queues a change that has no IndexedDB record of its own (the shared baby settings).
export function dbQueue(c: Change): Promise<void> {
  if (!queueing) return Promise.resolve()
  return write(OUTBOX, (s) => { s.put(queueEntry(c)); return [] }).then(() => queuedListener())
}

// Import from a backup, in one transaction over both stores. A record already on this device is kept unless
// the file's copy is newer (updatedAt), so an old backup never overwrites more recent edits; records it adds
// keep the file's timestamp (0 when it has none), so they never win over a deletion made elsewhere.
export function dbImport(feeds: Feed[], daily: Daily[], days: Day[] = [], events: EventRecord[] = []): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const stores = [STORE, DAILY_STORE, DAYS, EVENTS]
        const tx = db.transaction(queueing ? [...stores, OUTBOX] : stores, 'readwrite')
        let queued = 0
        const merge = <T extends { updatedAt?: number }>(store: IDBObjectStore, rec: T, key: string, change: (r: T) => Change) => {
          const get = store.get(key)
          get.onsuccess = () => {
            const existing = get.result as T | undefined
            if (existing && (existing.updatedAt || 0) >= (rec.updatedAt || 0)) return
            const r = { ...rec, updatedAt: rec.updatedAt || 0 }
            store.put(r)
            if (queueing) { tx.objectStore(OUTBOX).put(queueEntry(change(r))); queued++ }
          }
        }
        const fs = tx.objectStore(STORE), ds = tx.objectStore(DAILY_STORE)
        feeds.forEach((f) => merge(fs, f, f.id, feedChange))
        daily.forEach((d) => merge(ds, d, d.date, dailyChange))
        days.forEach((d) => merge(tx.objectStore(DAYS), d, d.id, dayChange))
        events.forEach((e) => merge(tx.objectStore(EVENTS), e, e.id, eventChange))
        tx.oncomplete = () => { if (queued) queuedListener(); resolve() }
        tx.onerror = () => reject(tx.error)
      }),
  )
}

// ---- Sharing: outbox and remote changes ----

// Queues every local record (joining or creating a family merges this device's history into it).
export function dbQueueAll(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, DAILY_STORE, DAYS, EVENTS, OUTBOX], 'readwrite')
        const out = tx.objectStore(OUTBOX)
        const all = <T>(store: string, change: (r: T) => Change) => {
          const req = tx.objectStore(store).getAll()
          req.onsuccess = () => (req.result as T[]).forEach((r) => out.put(queueEntry(change(r))))
        }
        all<Feed>(STORE, feedChange)
        all<Daily>(DAILY_STORE, dailyChange)
        all<Day>(DAYS, dayChange)
        all<EventRecord>(EVENTS, eventChange)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export const dbOutbox = () => read<OutboxEntry[]>(OUTBOX, (s) => s.getAll()).then((r) => r || [])
export const dbClearOutbox = () => write(OUTBOX, (s) => { s.clear(); return [] })

// Removes sent changes from the outbox, unless they were changed again meanwhile.
export function dbAckOutbox(sent: Change[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX, 'readwrite')
        const out = tx.objectStore(OUTBOX)
        sent.forEach((c) => {
          const k = c.kind + ':' + c.key
          const get = out.get(k)
          get.onsuccess = () => { if (get.result && get.result.updatedAt === c.updatedAt) out.delete(k) }
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

// Applies changes pulled from the family (not queued again). A local record newer than the remote one is
// kept (its own change is still in the outbox). On equal timestamps the server's copy wins, because the server
// kept it over ours: this is what makes two phones converge when both had the same record before sharing
// (every pre-sharing record has updatedAt 0). Identical content (our own echo) is not rewritten.
// Returns the number of records changed, the latest baby settings received, if any, and the profiles
// (other babies, names) received, which live in localStorage and are applied by the caller.
const STORE_OF: Record<string, string> = { feed: STORE, bfeed: STORE, daily: DAILY_STORE, day: DAYS, event: EVENTS }
export function dbApplyRemote(changes: Change[]): Promise<{ applied: number; baby: Change | null; profiles: Change[] }> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, DAILY_STORE, DAYS, EVENTS], 'readwrite')
        let applied = 0
        let baby: Change | null = null
        const profiles: Change[] = []
        for (const c of changes) {
          if (c.kind === 'baby') { if (!c.deleted && (!baby || baby.updatedAt < c.updatedAt)) baby = c; continue }
          if (c.kind === 'profile') { profiles.push(c); continue }
          if (!STORE_OF[c.kind]) continue // a kind from a newer version of the app
          if (!c.deleted && !validRemote(c)) continue
          const store = tx.objectStore(STORE_OF[c.kind])
          const get = store.get(c.key)
          get.onsuccess = () => {
            const local = get.result as Record<string, unknown> | undefined
            if (local) {
              const lu = Number(local.updatedAt) || 0
              if (lu > c.updatedAt) return
              if (lu === c.updatedAt && (c.deleted ? false : sameRecord(c.kind, local, c.data as Record<string, unknown>))) return
            }
            if (c.deleted) { if (local) { store.delete(c.key); applied++ } }
            else { store.put({ ...(c.data as object), updatedAt: c.updatedAt }); applied++ }
          }
        }
        tx.oncomplete = () => resolve({ applied, baby, profiles })
        tx.onerror = () => reject(tx.error)
      }),
  )
}

// what the other phone sent must look like our own records before it reaches the UI
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
function validRemote(c: Change) {
  const d = c.data as Record<string, unknown> | null
  if (!d) return false
  const day = typeof d.date === 'string' && DAY_RE.test(d.date)
  const time = typeof d.time === 'string' && !isNaN(Date.parse(d.time))
  if (c.kind === 'feed') return d.id === c.key && day && Number(d.ml) > 0 && time && !d.babyId
  if (c.kind === 'bfeed') return d.id === c.key && day && Number(d.ml) > 0 && time && typeof d.babyId === 'string' && d.babyId !== FIRST_BABY
  if (c.kind === 'daily') return d.date === c.key && typeof d.vitaminD === 'boolean'
  if (c.kind === 'day') return d.id === c.key && typeof d.babyId === 'string' && c.key === d.babyId + '|' + d.date && typeof d.vitaminD === 'boolean'
  if (c.kind === 'event') return d.id === c.key && day && time && typeof d.type === 'string'
  return false
}

// Compares the meaningful fields only: Postgres jsonb does not keep key order, so JSON strings can differ.
const FEED_FIELDS = ['id', 'date', 'ml', 'time', 'type', 'note', 'by', 'babyId']
const FIELDS: Record<string, string[]> = {
  feed: FEED_FIELDS, bfeed: FEED_FIELDS, daily: ['date', 'vitaminD', 'vitaminDTime'], day: ['id', 'babyId', 'date', 'vitaminD', 'vitaminDTime'],
}
function sameRecord(kind: ChangeKind, a: Record<string, unknown>, b: Record<string, unknown>) {
  // events carry type-specific fields: compare all of them, key-order independent
  const fields = FIELDS[kind] || [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => f !== 'updatedAt')
  return fields.every((f) => (a[f] ?? null) === (b[f] ?? null))
}

export function newId() {
  return Date.now() + '-' + Math.random().toString(36).slice(2, 7)
}

// one-time migration from the old localStorage version, if present
export function migrateFromLocalStorage(): Promise<void> {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return Promise.resolve()
    const parsed: Record<string, Array<Partial<Feed>>> = JSON.parse(raw) || {}
    const jobs: Promise<void>[] = []
    Object.keys(parsed).forEach((date) => {
      ;(parsed[date] || []).forEach((e) => {
        jobs.push(
          dbAdd({ id: e.id || newId(), date, ml: e.ml as number, time: e.time as string }).catch(() => {}),
        )
      })
    })
    return Promise.all(jobs).then(() => {
      localStorage.removeItem(LEGACY_KEY)
    })
  } catch (e) {
    return Promise.resolve()
  }
}
