// A stand-in for Neon Auth in end-to-end tests: accounts, email codes ("123456") and EdDSA tokens signed with
// a key made for the test, which the test server verifies like production verifies Neon's. The page gets
// FAKE_AUTH_SCRIPT (window.__testAuth, the seam in src/lib/auth.ts) before the app loads.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'

export const TEST_CODE = '123456'

export async function fakeAuth(accountStore) {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'EdDSA' }] })
  const users = accountStore.users
  const passwords = new Map()
  let n = 0
  const byEmail = (email) => [...users.values()].find((u) => u.email.toLowerCase() === String(email).toLowerCase())
  const pub = (u) => ({ id: u.id, email: u.email, name: u.name, emailVerified: !!u.emailVerified })
  const handlers = {
    'sign-up': ({ email, password, name }) => {
      if (byEmail(email)) return { error: 'USER_ALREADY_EXISTS' }
      if (String(password).length < 8) return { error: 'PASSWORD_TOO_SHORT' }
      const u = { id: 'user-' + ++n, email, name: name || '', emailVerified: false }
      users.set(u.id, u); passwords.set(u.id, password)
      return { user: pub(u) }
    },
    'sign-in': ({ email, password }) => {
      const u = byEmail(email)
      return u && passwords.get(u.id) === password ? { user: pub(u) } : { error: 'INVALID_EMAIL_OR_PASSWORD' }
    },
    // Google accounts come verified
    google: ({ email, name }) => {
      let u = byEmail(email)
      if (!u) { u = { id: 'user-' + ++n, email, name, emailVerified: true }; users.set(u.id, u) }
      return { user: pub(u) }
    },
    user: ({ uid }) => ({ user: users.has(uid) ? pub(users.get(uid)) : null }),
    token: async ({ uid }) => ({ token: users.has(uid) ? await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test' }).setSubject(uid).setIssuedAt().setExpirationTime('15m').sign(privateKey) : null }),
    'send-code': ({ email }) => ({ ok: !!byEmail(email) }),
    verify: ({ email, code }) => { const u = byEmail(email); if (!u || code !== TEST_CODE) return { ok: false }; u.emailVerified = true; return { ok: true } },
    reset: ({ email, code, password }) => { const u = byEmail(email); if (!u || code !== TEST_CODE) return { ok: false }; passwords.set(u.id, password); return { ok: true } },
  }
  return { keys, handle: async (path, body) => (handlers[path] ? handlers[path](body || {}) : { error: 'unknown' }) }
}

export const FAKE_AUTH_SCRIPT = `(function () {
  var uid = function () { return localStorage.getItem("test-auth-uid") };
  var call = function (path, body) { return fetch("/test-auth/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json() }) };
  var login = function (r) { if (r.user) { localStorage.setItem("test-auth-uid", r.user.id); return { ok: true } } return { ok: false, error: r.error || "ERROR" } };
  var ok = function (r, err) { return r.ok ? { ok: true } : { ok: false, error: err } };
  window.__testAuth = {
    getUser: function () { return uid() ? call("user", { uid: uid() }).then(function (r) { return r.user }) : Promise.resolve(null) },
    token: function () { return uid() ? call("token", { uid: uid() }).then(function (r) { return r.token }) : Promise.resolve(null) },
    signUp: function (email, password, name) { return call("sign-up", { email: email, password: password, name: name }).then(login) },
    signIn: function (email, password) { return call("sign-in", { email: email, password: password }).then(login) },
    signInGoogle: function () { return call("google", { email: localStorage.getItem("test-google-email") || "google@example.com", name: "Google" }).then(login) },
    signOut: function () { localStorage.removeItem("test-auth-uid"); return Promise.resolve() },
    sendCode: function (email, type) { return call("send-code", { email: email, type: type }).then(function (r) { return ok(r, "ERROR") }) },
    verifyEmail: function (email, code) { return call("verify", { email: email, code: code }).then(function (r) { return ok(r, "INVALID_OTP") }) },
    resetPassword: function (email, code, password) { return call("reset", { email: email, code: code, password: password }).then(function (r) { return ok(r, "INVALID_OTP") }) },
  };
})()`
