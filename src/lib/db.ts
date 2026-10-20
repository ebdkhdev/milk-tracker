// IndexedDB layer. Names must stay as they are: existing users' data lives here. Bump DB_VERSION for any
// schema change and keep earlier versions upgradable in onupgradeneeded.
const DB_NAME = 'suivi-lait-db'
const DB_VERSION = 3
const STORE = 'feeds'
const DAILY_STORE = 'daily'
const OUTBOX = 'outbox' // v3: changes waiting to be sent to the family (sharing only)
const LEGACY_KEY = 'suivi-lait-data-v1'

export type MilkType = 'formula' | 'breast'
// type and note are optional: older records (and users who don't track the type) have neither.
// updatedAt (ms) is stamped on every local write; sharing resolves conflicts with it (last write wins).
// by: name of the parent who added it (sharing), set once on add and kept through edits
export type Feed = { id: string; date: string; ml: number; time: string; type?: MilkType; note?: string; by?: string; updatedAt?: number }
export type Daily = { date: string; vitaminD: boolean; vitaminDTime: string | null; updatedAt?: number }

export type ChangeKind = 'feed' | 'daily' | 'baby'
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

const feedChange = (f: Feed): Change => ({ kind: 'feed', key: f.id, data: f, deleted: false, updatedAt: f.updatedAt || 0 })
const dailyChange = (d: Daily): Change => ({ kind: 'daily', key: d.date, data: d, deleted: false, updatedAt: d.updatedAt || 0 })

// Every local write is stamped now, so an undo (re-putting a deleted bottle) wins over its deletion.
export const dbAdd = (entry: Feed) => {
  const f = { ...entry, updatedAt: Date.now() }
  return write(STORE, (s) => { s.add(f); return [feedChange(f)] })
}
export const dbPut = (entry: Feed) => {
  const f = { ...entry, updatedAt: Date.now() }
  return write(STORE, (s) => { s.put(f); return [feedChange(f)] })
}
export const dbDelete = (id: string) =>
  write(STORE, (s) => { s.delete(id); return [{ kind: 'feed', key: id, data: null, deleted: true, updatedAt: Date.now() }] })
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

// Queues a change that has no IndexedDB record of its own (the shared baby settings).
export function dbQueue(c: Change): Promise<void> {
  if (!queueing) return Promise.resolve()
  return write(OUTBOX, (s) => { s.put(queueEntry(c)); return [] }).then(() => queuedListener())
}

// Import from a backup, in one transaction over both stores. A record already on this device is kept unless
// the file's copy is newer (updatedAt), so an old backup never overwrites more recent edits; records it adds
// keep the file's timestamp (0 when it has none), so they never win over a deletion made elsewhere.
export function dbImport(feeds: Feed[], daily: Daily[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(queueing ? [STORE, DAILY_STORE, OUTBOX] : [STORE, DAILY_STORE], 'readwrite')
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
        const tx = db.transaction([STORE, DAILY_STORE, OUTBOX], 'readwrite')
        const out = tx.objectStore(OUTBOX)
        const feeds = tx.objectStore(STORE).getAll()
        feeds.onsuccess = () => (feeds.result as Feed[]).forEach((f) => out.put(queueEntry(feedChange(f))))
        const daily = tx.objectStore(DAILY_STORE).getAll()
        daily.onsuccess = () => (daily.result as Daily[]).forEach((d) => out.put(queueEntry(dailyChange(d))))
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
// Returns the number of records changed and the latest baby settings received, if any.
export function dbApplyRemote(changes: Change[]): Promise<{ applied: number; baby: Change | null }> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, DAILY_STORE], 'readwrite')
        let applied = 0
        let baby: Change | null = null
        for (const c of changes) {
          if (c.kind === 'baby') { if (!c.deleted && (!baby || baby.updatedAt < c.updatedAt)) baby = c; continue }
          if (!c.deleted && !validRemote(c)) continue
          const store = tx.objectStore(c.kind === 'feed' ? STORE : DAILY_STORE)
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
        tx.oncomplete = () => resolve({ applied, baby })
        tx.onerror = () => reject(tx.error)
      }),
  )
}

// what the other phone sent must look like our own records before it reaches the UI
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
function validRemote(c: Change) {
  const d = c.data as Record<string, unknown> | null
  if (!d) return false
  if (c.kind === 'feed') return d.id === c.key && typeof d.date === 'string' && DAY_RE.test(d.date) && Number(d.ml) > 0 && typeof d.time === 'string' && !isNaN(Date.parse(d.time))
  return d.date === c.key && typeof d.vitaminD === 'boolean'
}

// Compares the meaningful fields only: Postgres jsonb does not keep key order, so JSON strings can differ.
const FIELDS: Record<string, string[]> = { feed: ['id', 'date', 'ml', 'time', 'type', 'note', 'by'], daily: ['date', 'vitaminD', 'vitaminDTime'] }
function sameRecord(kind: ChangeKind, a: Record<string, unknown>, b: Record<string, unknown>) {
  return (FIELDS[kind] || []).every((f) => (a[f] ?? null) === (b[f] ?? null))
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
