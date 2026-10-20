// Family sharing, client side. Local data stays the source of truth and the app works offline: local writes
// are queued (db.ts outbox) and sent to /api/sync, which returns what the other phones changed since our
// cursor. Conflicts: last write wins (updatedAt), decided by the server and re-checked in dbApplyRemote.
import { dbAckOutbox, dbApplyRemote, dbClearOutbox, dbOutbox, dbQueueAll, onQueued, setQueueing } from './db'
import type { Change } from './db'
import { deviceToken } from './push'

const SYNC_KEY = 'suivi-lait-sync-v1'
const ENDPOINT = '/api/sync'
const CHUNK = 500 // matches MAX_CHANGES on the server

export type SyncState = { code: string | null; cursor: number; lastSync: string | null }
// 'gone': the family was deleted (from the other phone); the app then stops sharing
export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'error' | 'gone'
export type SyncResult = { status: SyncStatus; applied: number; baby: Change | null }

export function loadSync(): SyncState {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null')
    if (s && typeof s === 'object' && typeof s.code === 'string') return { code: s.code, cursor: Number(s.cursor) || 0, lastSync: s.lastSync || null }
  } catch (e) {}
  return { code: null, cursor: 0, lastSync: null }
}
function saveSync(s: SyncState) {
  try {
    if (s.code) localStorage.setItem(SYNC_KEY, JSON.stringify(s))
    else localStorage.removeItem(SYNC_KEY)
  } catch (e) {}
}

// The code as people type or paste it: letters and digits only, grouped by four for display.
export const formatCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-')

// Called on boot: a device that is in a family queues its writes from now on.
export function initSync(onLocalChange: () => void) {
  setQueueing(!!loadSync().code)
  onQueued(onLocalChange)
}

async function post(body: object, code?: string) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(code ? { 'X-Family-Code': code } : {}),
      ...(deviceToken() ? { 'X-Device-Token': deviceToken()! } : {}),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

export async function createFamily(): Promise<string> {
  const { status, json } = await post({ action: 'create' })
  if (status !== 200 || typeof json.code !== 'string') throw new Error('create failed')
  await startSharing(json.code)
  return json.code
}

// Joining checks the code first (an unknown code must not switch this device into sharing).
export async function joinFamily(code: string): Promise<'ok' | 'unknown' | 'offline'> {
  const clean = formatCode(code)
  let r
  try { r = await post({ action: 'sync', since: 0, changes: [] }, clean) } catch (e) { return 'offline' }
  if (r.status === 404 || r.status === 401) return 'unknown'
  if (r.status !== 200) return 'offline'
  await startSharing(clean)
  return 'ok'
}

// Both create and join merge this device's whole history into the family.
async function startSharing(code: string) {
  saveSync({ code, cursor: 0, lastSync: null })
  setQueueing(true)
  await dbQueueAll()
}

// Leaving keeps every record on this device; it only stops sharing.
export async function leaveFamily() {
  saveSync({ code: null, cursor: 0, lastSync: null })
  setQueueing(false)
  await dbClearOutbox()
}

// Deletes the family and everything it shared from the server, then leaves it (local data is kept).
export async function deleteFamily(): Promise<'ok' | 'offline'> {
  const { code } = loadSync()
  if (!code) return 'ok'
  let r
  try { r = await post({ action: 'delete' }, code) } catch (e) { return 'offline' }
  if (r.status !== 200 && r.status !== 404) return 'offline'
  await leaveFamily()
  return 'ok'
}

let running: Promise<SyncResult> | null = null

// Sends the outbox, pulls the family's changes, repeats until both are drained. One run at a time.
export function syncNow(): Promise<SyncResult> {
  if (running) return running
  running = doSync().finally(() => { running = null })
  return running
}

async function doSync(): Promise<SyncResult> {
  let state = loadSync()
  if (!state.code) return { status: 'idle', applied: 0, baby: null }
  let applied = 0
  let baby: Change | null = null
  try {
    for (let round = 0; round < 50; round++) {
      const outbox = (await dbOutbox()).slice(0, CHUNK)
      const changes: Change[] = outbox.map(({ kind, key, data, deleted, updatedAt }) => ({ kind, key, data, deleted, updatedAt }))
      const { status, json } = await post({ action: 'sync', since: state.cursor, changes }, state.code!)
      if (status === 404) return { status: 'gone', applied, baby }
      if (status !== 200) return { status: 'error', applied, baby }
      await dbAckOutbox(changes)
      const r = await dbApplyRemote(json.changes || [])
      applied += r.applied
      if (r.baby && (!baby || baby.updatedAt < r.baby.updatedAt)) baby = r.baby
      // the user may have left the family while this request was in flight
      if (!loadSync().code) return { status: 'idle', applied, baby: null }
      state = { ...state, cursor: Number(json.cursor) || state.cursor, lastSync: new Date().toISOString() }
      saveSync(state)
      if (!json.more && (await dbOutbox()).length === 0) return { status: 'ok', applied, baby }
    }
    return { status: 'ok', applied, baby }
  } catch (e) {
    // network failure: everything stays queued for the next attempt
    return { status: 'offline', applied, baby }
  }
}
