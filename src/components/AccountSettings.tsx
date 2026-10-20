import { useState } from 'react'
import type { AuthResult, AuthUser } from '#/lib/auth'
import { useFormat } from '#/lib/format'

type Props = {
  user: AuthUser | null | undefined
  onSignIn: (email: string, password: string) => Promise<AuthResult>
  onSignUp: (email: string, password: string, name: string) => Promise<AuthResult>
  onGoogle: () => Promise<AuthResult>
  onSignOut: () => void
  onSendCode: (email: string, type: 'email-verification' | 'forget-password') => Promise<AuthResult>
  onVerify: (email: string, code: string) => Promise<AuthResult>
  onReset: (email: string, code: string, password: string) => Promise<AuthResult>
}

const KNOWN = ['INVALID_EMAIL_OR_PASSWORD', 'USER_ALREADY_EXISTS', 'PASSWORD_TOO_SHORT', 'INVALID_OTP', 'OFFLINE']

// Settings section: sign in / create an account / reset the password by email code; once signed in, the
// address, its verification (by code) and sign-out.
export function AccountSettings({ user, onSignIn, onSignUp, onGoogle, onSignOut, onSendCode, onVerify, onReset }: Props) {
  const { t } = useFormat()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const errorText = (r: AuthResult) => {
    if (r.ok) return ''
    const known = KNOWN.find((k) => r.error.toUpperCase().includes(k.replace('USER_', '')) || r.error.toUpperCase() === k)
    return t(known ? 'err_' + known : 'err_GENERIC')
  }
  const run = async (job: () => Promise<AuthResult>, done?: string) => {
    setBusy(true)
    setMessage(null)
    let r: AuthResult
    try { r = await job() } catch (e) { r = { ok: false, error: 'OFFLINE' } }
    setBusy(false)
    if (!r.ok) setMessage({ text: errorText(r), error: true })
    else if (done) setMessage({ text: done, error: false })
    return r
  }
  const note = message ? <p className={'settings-note' + (message.error ? ' share-error' : '')} id="account-message" role={message.error ? 'alert' : 'status'}>{message.text}</p> : null

  if (user === undefined) return null
  if (user) {
    return (
      <>
        <p className="share-status" id="account-email">{t('signedInAs', { email: user.email })}</p>
        {!user.emailVerified ? (
          <div className="share-confirm" id="verify-email">
            <p>{t('notVerified')}</p>
            {codeSent ? (
              <label className="care-time"><span>{t('code')}</span><input type="text" inputMode="numeric" autoComplete="one-time-code" id="verify-code" value={code} onChange={(e) => setCode(e.target.value.trim())} /></label>
            ) : null}
            <div className="data-row">
              {codeSent ? (
                <button className="data-btn primary" id="verify-submit" disabled={busy || !code} onClick={() => run(() => onVerify(user.email, code), t('verified'))}>{t('verifyBtn')}</button>
              ) : (
                <button className="data-btn" id="verify-send" disabled={busy} onClick={async () => { if ((await run(() => onSendCode(user.email, 'email-verification'), t('codeSent', { email: user.email }))).ok) setCodeSent(true) }}>{t('sendCode')}</button>
              )}
            </div>
          </div>
        ) : null}
        {note}
        <button className="settings-reset share-leave" id="sign-out" onClick={onSignOut}>{t('signOut')}</button>
      </>
    )
  }

  if (mode === 'reset') {
    return (
      <div className="account-form" id="reset-form">
        <p className="settings-note share-intro">{t('resetTitle')}</p>
        <label className="care-time"><span>{t('email')}</span><input type="email" autoComplete="email" id="reset-email" value={email} onChange={(e) => setEmail(e.target.value.trim())} /></label>
        {codeSent ? (
          <>
            <label className="care-time"><span>{t('code')}</span><input type="text" inputMode="numeric" autoComplete="one-time-code" id="reset-code" value={code} onChange={(e) => setCode(e.target.value.trim())} /></label>
            <label className="care-time"><span>{t('newPassword')}</span><input type="password" autoComplete="new-password" id="reset-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="data-btn primary" id="reset-submit" disabled={busy || !code || password.length < 8} onClick={async () => { if ((await run(() => onReset(email, code, password))).ok) { setMode('signin'); setCodeSent(false); setCode(''); setMessage({ text: t('verified'), error: false }) } }}>{t('resetBtn')}</button>
          </>
        ) : (
          <button className="data-btn primary" id="reset-send" disabled={busy || !email} onClick={async () => { if ((await run(() => onSendCode(email, 'forget-password'), t('codeSent', { email }))).ok) setCodeSent(true) }}>{t('sendCode')}</button>
        )}
        {note}
        <button className="settings-reset" id="reset-back" onClick={() => { setMode('signin'); setCodeSent(false); setMessage(null) }}>{t('backToSignIn')}</button>
      </div>
    )
  }

  const signup = mode === 'signup'
  return (
    <div className="account-form" id="account-form">
      <p className="settings-note share-intro">{t('accountIntro')}</p>
      <div className="milk-toggle account-tabs" role="group" aria-label={t('accountTitle')}>
        <button type="button" id="mode-signin" className={!signup ? 'active' : ''} aria-pressed={!signup} onClick={() => { setMode('signin'); setMessage(null) }}>{t('signInTab')}</button>
        <button type="button" id="mode-signup" className={signup ? 'active' : ''} aria-pressed={signup} onClick={() => { setMode('signup'); setMessage(null) }}>{t('signUpTab')}</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); run(() => (signup ? onSignUp(email, password, name) : onSignIn(email, password))) }}>
        {signup ? <label className="care-time"><span>{t('yourName')}</span><input type="text" autoComplete="given-name" id="auth-name" value={name} onChange={(e) => setName(e.target.value)} /></label> : null}
        <label className="care-time"><span>{t('email')}</span><input type="email" autoComplete="email" id="auth-email" value={email} onChange={(e) => setEmail(e.target.value.trim())} /></label>
        <label className="care-time"><span>{t('password')}</span><input type="password" autoComplete={signup ? 'new-password' : 'current-password'} id="auth-password" placeholder={signup ? t('passwordHint') : undefined} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="submit" className="data-btn primary" id="auth-submit" disabled={busy || !email || !password || (signup && password.length < 8)}>{t(signup ? 'signUpBtn' : 'signInBtn')}</button>
      </form>
      <button className="data-btn google-btn" id="auth-google" disabled={busy} onClick={() => run(onGoogle)}>
        <span aria-hidden="true">G</span> {t('google')}
      </button>
      {!signup ? <button className="settings-reset" id="auth-forgot" onClick={() => { setMode('reset'); setMessage(null) }}>{t('forgot')}</button> : null}
      {note}
    </div>
  )
}
