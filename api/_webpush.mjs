// Web Push sending (VAPID). The private key is a server-only env var, never exposed to the client build.
import webpush from 'web-push'

let configured = false
function setup() {
  if (configured) return
  // the subject identifies the sender to push services; the app URL, not a personal email
  webpush.setVapidDetails('https://suivi-lait.vercel.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  configured = true
}

export const webPushSender = {
  async send(sub, payload) {
    setup()
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' })
      return 'ok'
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) return 'gone' // unsubscribed or expired
      throw e
    }
  },
}
