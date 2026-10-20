import { useCallback, useEffect, useRef, useState } from 'react'
import { accountCall, householdStatus, linkHousehold } from '#/lib/account'
import type { Household } from '#/lib/account'
import { auth } from '#/lib/auth'
import type { AuthResult, AuthUser } from '#/lib/auth'
import { leaveFamily, loadSync, startAccountSync } from '#/lib/sync'

type Options = {
  ready: boolean // local data migrated
  onLinked: () => void // the phone now syncs through the account: refresh state and sync
}

// The optional account. Signing in links the account to a household (this phone's family code one if it
// has a code, the account's own otherwise) and queues the whole local history: that is how the data moves to
// the server. Signing out stops syncing and keeps the data on the phone.
export function useAccount({ ready, onLinked }: Options) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined) // undefined: not known yet
  const [household, setHousehold] = useState<Household | null>(null)
  const linking = useRef(false)
  const latest = useRef(onLinked)
  latest.current = onLinked

  const refreshUser = useCallback(async () => {
    try { setUser(await (await auth()).getUser()) } catch (e) { setUser(null) }
  }, [])
  useEffect(() => { refreshUser() }, [refreshUser])

  const refreshHousehold = useCallback(async () => { setHousehold(await householdStatus()) }, [])

  // signed in (also after coming back from Google) but not syncing through the account yet: link
  const link = useCallback(async () => {
    if (linking.current) return
    linking.current = true
    try {
      const r = await linkHousehold(loadSync().account ? null : loadSync().code)
      if (r.status === 200) {
        if (!loadSync().account) await startAccountSync()
        latest.current()
        refreshHousehold()
      }
    } finally {
      linking.current = false
    }
  }, [refreshHousehold])
  useEffect(() => { if (ready && user && !loadSync().account) link() }, [ready, user, link])

  const afterAuth = async (r: AuthResult) => {
    if (r.ok) await refreshUser()
    return r
  }

  return {
    user,
    household,
    refreshHousehold,
    // the server says the account has no household any more (left, or erased by the other parent)
    relink: async () => { await startAccountSync(); await link() },
    signIn: async (email: string, password: string) => afterAuth(await (await auth()).signIn(email, password)),
    signUp: async (email: string, password: string, name: string) => afterAuth(await (await auth()).signUp(email, password, name)),
    // in production the page leaves for Google and the session is read when it comes back; reading it here
    // too is harmless
    signInGoogle: async () => afterAuth(await (await auth()).signInGoogle()),
    signOut: async () => {
      await (await auth()).signOut().catch(() => {})
      await leaveFamily() // stops syncing; every record stays on this phone
      setUser(null)
      setHousehold(null)
    },
    sendCode: async (email: string, type: 'email-verification' | 'forget-password') => (await auth()).sendCode(email, type),
    verifyEmail: async (email: string, code: string) => afterAuth(await (await auth()).verifyEmail(email, code)),
    resetPassword: async (email: string, code: string, password: string) => (await auth()).resetPassword(email, code, password),
    invite: async (email: string) => { const r = await accountCall({ action: 'invite', email }); await refreshHousehold(); return r.status },
    cancelInvite: async (id: number) => { await accountCall({ action: 'cancel', inviteId: id }); await refreshHousehold() },
    declineInvite: async (id: number) => { await accountCall({ action: 'decline', inviteId: id }); await refreshHousehold() },
    // joining another household: this phone's data is merged into it (re-queued from cursor 0)
    acceptInvite: async (id: number) => {
      const r = await accountCall({ action: 'accept', inviteId: id })
      if (r.status === 200) { await startAccountSync(); latest.current(); await refreshHousehold() }
      return r.status
    },
    // leaving: the account then gets its own household again, with this phone's data
    leaveHousehold: async () => {
      await accountCall({ action: 'leave' })
      await startAccountSync()
      await link()
    },
  }
}
