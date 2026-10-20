// Sign-in (Neon Auth, managed Better Auth), behind a small interface. Neon Auth is reached through /auth on
// the app's own origin (vercel.json rewrite, Vite proxy in development) so its session cookies are
// first-party: Safari blocks third-party cookies, which would lose the session on every reload.
//
// Tests replace the implementation by defining window.__testAuth before the app loads; the server still
// verifies every token's signature against Neon's keys, so this cannot forge anything in production.

export type AuthUser = { id: string; email: string; name: string; emailVerified: boolean }
export type AuthResult = { ok: true } | { ok: false; error: string } // error: a code ("INVALID_EMAIL_OR_PASSWORD", …)

export interface AuthApi {
  getUser(): Promise<AuthUser | null>
  token(fresh?: boolean): Promise<string | null> // a short-lived JWT (15 min) for our API; fresh skips any cache
  signUp(email: string, password: string, name: string): Promise<AuthResult>
  signIn(email: string, password: string): Promise<AuthResult>
  signInGoogle(): Promise<AuthResult> // redirects; the session is picked up when the app reloads
  signOut(): Promise<void>
  sendCode(email: string, type: 'email-verification' | 'forget-password'): Promise<AuthResult>
  verifyEmail(email: string, code: string): Promise<AuthResult>
  resetPassword(email: string, code: string, password: string): Promise<AuthResult>
}

type Res = { data?: unknown; error?: { code?: string; message?: string } | null }
const result = (r: Res): AuthResult => (r && r.error ? { ok: false, error: r.error.code || r.error.message || 'ERROR' } : { ok: true })

let impl: Promise<AuthApi> | null = null

// Created on first use (never at module load: the app is prerendered without a window).
export function auth(): Promise<AuthApi> {
  const test = (window as unknown as { __testAuth?: AuthApi }).__testAuth
  if (test) return Promise.resolve(test)
  impl ||= import('@neondatabase/auth').then(({ createAuthClient }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = createAuthClient(window.location.origin + '/auth')
    const api: AuthApi = {
      async getUser() {
        const r = await c.getSession()
        const u = r && r.data && r.data.user
        return u ? { id: u.id, email: u.email, name: u.name || '', emailVerified: !!u.emailVerified } : null
      },
      async token(fresh) {
        if (!fresh && typeof c.getJWTToken === 'function') return (await c.getJWTToken()) || null
        const r = await c.token() // asks the server: never a cached, possibly expired token
        return (r && r.data && r.data.token) || null
      },
      signUp: async (email, password, name) => result(await c.signUp.email({ email, password, name })),
      signIn: async (email, password) => result(await c.signIn.email({ email, password })),
      signInGoogle: async () => result(await c.signIn.social({ provider: 'google', callbackURL: window.location.origin + '/' })),
      signOut: async () => { await c.signOut() },
      sendCode: async (email, type) =>
        result(type === 'forget-password' && c.emailOtp.requestPasswordReset
          ? await c.emailOtp.requestPasswordReset({ email })
          : await c.emailOtp.sendVerificationOtp({ email, type })),
      verifyEmail: async (email, otp) => result(await c.emailOtp.verifyEmail({ email, otp })),
      resetPassword: async (email, otp, password) => result(await c.emailOtp.resetPassword({ email, otp, password })),
    }
    return api
  })
  return impl
}
