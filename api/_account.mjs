// Accounts (Neon Auth) and households. An account belongs to at most one household, which is a row of the
// `families` table used by sync: so a signed-in phone syncs exactly like a phone with a family code, only the
// way the family is found differs (membership instead of code). Older apps keep using their code.
//
// POST /api/account, header Authorization: Bearer <Neon Auth JWT>
//   { action: "status" }                      -> { familyId, emailVerified, members, sent, received }
//   { action: "link", familyCode? }           -> join the household of this phone's family code, or create one
//   { action: "invite", email }               -> invite the other parent (by the email they sign in with)
//   { action: "accept", inviteId }            -> join the inviting household (verified matching email only)
//   { action: "decline" | "cancel", inviteId }
//   { action: "leave" }                       -> leave the household (its data stays for the others)
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { hashCode, normalizeCode } from './_core.mjs'

const INVITE_DAYS = 14
const MAX_PENDING_INVITES = 10
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

// Verifies a Neon Auth token (EdDSA, this project's keys) and returns the account id, or null.
// keySet: the remote JWKS in production, a local key set in tests.
export async function verifyAccount(authorization, keySet) {
  const m = /^Bearer\s+(.+)$/i.exec(authorization || '')
  if (!m) return null
  try {
    const { payload } = await jwtVerify(m[1], keySet, { algorithms: ['EdDSA'] })
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch (e) {
    return null // expired, badly signed, malformed
  }
}

let remote
export function neonKeySet() {
  remote ||= createRemoteJWKSet(new URL(process.env.NEON_AUTH_BASE_URL.replace(/\/$/, '') + '/.well-known/jwks.json'))
  return remote
}

const newFamilyHash = () => createHash('sha256').update(randomBytes(32)).digest('hex') // no code: reached by membership only
const lower = (s) => String(s || '').trim().toLowerCase()

// store: account methods of api/_pg.mjs (accountStore) or tests/lib/memory-store.mjs (memoryAccountStore)
export async function handleAccount({ body, userId }, store, now = Date.now()) {
  if (!userId) return { status: 401, body: { error: 'not signed in' } }
  if (!body || typeof body !== 'object') return { status: 400, body: { error: 'bad request' } }
  const user = await store.getUser(userId)
  if (!user) return { status: 401, body: { error: 'unknown account' } }
  const familyId = await store.memberFamily(userId)

  if (body.action === 'status') {
    const [members, sent, received] = await Promise.all([
      familyId ? store.familyMembers(familyId) : [],
      familyId ? store.sentInvites(familyId, now) : [],
      store.invitesFor(lower(user.email), now),
    ])
    return {
      status: 200,
      body: {
        familyId,
        emailVerified: !!user.emailVerified,
        members: members.map((m) => ({ name: m.name || '', email: m.email, you: m.userId === userId })),
        sent: sent.map((i) => ({ id: i.id, email: i.email })),
        received: received.filter((i) => i.familyId !== familyId).map((i) => ({ id: i.id, from: i.fromName || i.fromEmail })),
      },
    }
  }

  if (body.action === 'link') {
    if (familyId) return { status: 200, body: { familyId, created: false } }
    // the phone's family code proves it belongs to that household (accounts of an existing code family)
    if (body.familyCode && normalizeCode(body.familyCode).length === 26) {
      const id = await store.familyIdByHash(hashCode(body.familyCode))
      if (id) { await store.addMember(userId, id); return { status: 200, body: { familyId: id, joined: true } } }
    }
    const id = await store.createAccountFamily(newFamilyHash())
    await store.addMember(userId, id)
    return { status: 200, body: { familyId: id, created: true } }
  }

  if (body.action === 'invite') {
    if (!familyId) return { status: 409, body: { error: 'no household' } }
    const email = lower(body.email)
    if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'bad email' } }
    if (email === lower(user.email)) return { status: 400, body: { error: 'own email' } }
    const pending = await store.sentInvites(familyId, now)
    if (!pending.some((i) => i.email === email) && pending.length >= MAX_PENDING_INVITES) return { status: 429, body: { error: 'too many invitations' } }
    await store.upsertInvite(familyId, email, userId, new Date(now + INVITE_DAYS * 86400e3))
    return { status: 200, body: { ok: true } }
  }

  if (body.action === 'accept') {
    // only the owner of the invited address, once proven: otherwise anyone signing up with the other
    // parent's email would read the baby's data
    if (!user.emailVerified) return { status: 403, body: { error: 'email not verified' } }
    const invite = await store.getInvite(Number(body.inviteId))
    if (!invite || invite.email !== lower(user.email) || invite.expiresAt <= now) return { status: 404, body: { error: 'unknown invitation' } }
    if (familyId !== invite.familyId) {
      if (familyId) await store.removeMember(userId)
      await store.addMember(userId, invite.familyId)
      // a household made for this account alone, now empty, is removed (its data was on this phone)
      if (familyId) await store.deleteFamilyIfOrphan(familyId)
    }
    await store.deleteInvite(invite.id)
    return { status: 200, body: { familyId: invite.familyId } }
  }

  if (body.action === 'decline' || body.action === 'cancel') {
    const invite = await store.getInvite(Number(body.inviteId))
    const allowed = invite && (body.action === 'decline' ? invite.email === lower(user.email) : invite.familyId === familyId)
    if (!allowed) return { status: 404, body: { error: 'unknown invitation' } }
    await store.deleteInvite(invite.id)
    return { status: 200, body: { ok: true } }
  }

  if (body.action === 'leave') {
    if (familyId) {
      await store.removeMember(userId)
      await store.deleteFamilyIfOrphan(familyId)
    }
    return { status: 200, body: { ok: true } }
  }
  return { status: 400, body: { error: 'unknown action' } }
}
