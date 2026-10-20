// The signed-in account's household, client side (server: api/_account.mjs).
import { auth } from './auth'

export type Household = {
  familyId: string | number | null
  emailVerified: boolean
  members: { name: string; email: string; you: boolean }[]
  sent: { id: number; email: string }[] // invitations waiting for the other parent
  received: { id: number; from: string }[] // invitations to join another household
}

// { status, json } for an /api/account action; status 0 when offline or signed out
export async function accountCall(body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  try {
    const a = await auth()
    let token = await a.token()
    if (!token) return { status: 0, json: {} }
    const send = () => fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) })
    let res = await send()
    if (res.status === 401) { token = await a.token(true); if (token) res = await send() }
    return { status: res.status, json: await res.json().catch(() => ({})) }
  } catch (e) {
    return { status: 0, json: {} }
  }
}

export const householdStatus = async (): Promise<Household | null> => {
  const r = await accountCall({ action: 'status' })
  return r.status === 200 ? (r.json as unknown as Household) : null
}
// joins the household of this phone's family code if it has one, else the account's own (created if needed)
export const linkHousehold = (familyCode: string | null) => accountCall({ action: 'link', ...(familyCode ? { familyCode } : {}) })
