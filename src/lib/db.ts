// IndexedDB layer. Names, version and schema must stay as they are: existing users' data lives here.
const DB_NAME = 'suivi-lait-db'
const DB_VERSION = 2
const STORE = 'feeds'
const DAILY_STORE = 'daily'
const LEGACY_KEY = 'suivi-lait-data-v1'

export type Feed = { id: string; date: string; ml: number; time: string }
export type Daily = { date: string; vitaminD: boolean; vitaminDTime: string | null }

let dbPromise: Promise<IDBDatabase> | null = null

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
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function write(storeName: string, op: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        op(tx.objectStore(storeName))
        tx.oncomplete = () => resolve()
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

export const dbAdd = (entry: Feed) => write(STORE, (s) => s.add(entry))
export const dbPut = (entry: Feed) => write(STORE, (s) => s.put(entry))
export const dbDelete = (id: string) => write(STORE, (s) => s.delete(id))
export const dbGetByDate = (date: string) =>
  read<Feed[]>(STORE, (s) => s.index('by_date').getAll(IDBKeyRange.only(date))).then((r) => r || [])
export const dbGetAll = () => read<Feed[]>(STORE, (s) => s.getAll()).then((r) => r || [])

export const dbGetDaily = (date: string) =>
  read<Daily | undefined>(DAILY_STORE, (s) => s.get(date)).then((r) => r || null)
export const dbPutDaily = (record: Daily) => write(DAILY_STORE, (s) => s.put(record))
export const dbGetAllDaily = () => read<Daily[]>(DAILY_STORE, (s) => s.getAll()).then((r) => r || [])

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
