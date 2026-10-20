// Push notifications, client side (server: api/_push.mjs). The phone subscribes with Web Push and keeps the
// server informed (language, time zone, choices, vitamin D given today, expected next bottle); the server
// decides and sends. A random device token identifies this phone (the server keeps only its hash).
import { isIos, isStandalone } from './platform'
import { loadSync } from './sync'

const PUSH_KEY = 'suivi-lait-push-v1'
const ENDPOINT = '/api/push'

export type PushState = { token: string; enabled: boolean; nextFeed: boolean; partner: boolean }
// what the server needs to know about this phone
export type PushDevice = {
  lang: string
  unit: string
  tz: string
  name: string
  prefs: { vitd: boolean; vitdTime: string; nextFeed: boolean; partner: boolean }
  vitdGivenDate?: string | null
  lastFeedAt?: number
  nextFeedAt?: number
}

// 'install': iOS only allows push for the app opened from the home screen
export function pushSupport(): 'ok' | 'install' | 'unsupported' {
  if (isIos() && !isStandalone()) return 'install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !window.isSecureContext) return 'unsupported'
  return 'ok'
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function loadPush(): PushState {
  try {
    const p = JSON.parse(localStorage.getItem(PUSH_KEY) || 'null')
    if (p && typeof p.token === 'string') return { token: p.token, enabled: !!p.enabled, nextFeed: p.nextFeed !== false, partner: p.partner !== false }
  } catch (e) {}
  return { token: newToken(), enabled: false, nextFeed: true, partner: true }
}
export function savePush(p: PushState) {
  try { localStorage.setItem(PUSH_KEY, JSON.stringify(p)) } catch (e) {}
}
// sent with /api/sync too, so the server doesn't notify this phone of its own bottles
export function deviceToken(): string | null {
  const p = loadPush()
  return p.enabled ? p.token : null
}

async function api(body: object, token: string) {
  // the family code proves membership (an empty header means "not in a family")
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': token, 'X-Family-Code': loadSync().code || '' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

function keyBytes(base64: string) {
  const s = atob(base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

async function subscribe(state: PushState, device: PushDevice) {
  const { json } = await api({ action: 'key' }, state.token)
  if (!json.publicKey) throw new Error('no key')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(json.publicKey) }))
  const r = await api({ action: 'subscribe', subscription: sub.toJSON(), ...device }, state.token)
  if (r.status !== 200) throw new Error('subscribe failed')
}

// Must be called directly from the tap: iOS only shows the permission prompt inside a user gesture,
// so the request comes before anything is awaited.
export function enablePush(state: PushState, device: PushDevice): Promise<'ok' | 'denied' | 'error'> {
  const permission = Notification.requestPermission()
  return permission
    .then(async (p) => {
      if (p !== 'granted') return 'denied' as const
      await subscribe(state, device)
      savePush({ ...state, enabled: true })
      return 'ok' as const
    })
    .catch(() => 'error' as const)
}

export async function disablePush(state: PushState) {
  savePush({ ...state, enabled: false })
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  } catch (e) {}
  await api({ action: 'unsubscribe' }, state.token).catch(() => {})
}

// On every start: iOS can replace the subscription without telling the page, so it is sent again.
// Both read the stored state when they run: an update scheduled before "turn off" must not subscribe again.
export async function refreshPush(state: PushState, device: PushDevice) {
  if (!loadPush().enabled || pushSupport() !== 'ok' || Notification.permission !== 'granted') return
  await subscribe(state, device).catch((e) => console.error('push refresh', e))
}

// Keeps the server up to date; it only reschedules what changed. A forgotten phone re-subscribes.
export async function updatePush(state: PushState, device: PushDevice) {
  if (!loadPush().enabled) return
  const r = await api({ action: 'update', ...device }, state.token).catch(() => null)
  if (r && r.status === 404) await refreshPush(state, device)
}
