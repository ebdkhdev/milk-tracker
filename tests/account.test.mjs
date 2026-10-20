// Accounts and households (api/_account.mjs): token verification with a local Ed25519 key, linking, email
// invitations (verified, matching email only), leaving, and syncing by account. No browser, no network.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { handle, hashCode, newCode } from '../api/_core.mjs'
import { handleAccount, verifyAccount } from '../api/_account.mjs'
import { check, equal, suite } from './lib/assert.mjs'
import { memoryAccountStore, memoryStore } from './lib/memory-store.mjs'

export async function run() {
  suite('Accounts and households (server)')
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'EdDSA' }
  const keys = createLocalJWKSet({ keys: [jwk] })
  const sign = (sub, exp = '15m', key = privateKey) => new SignJWT(sub ? { email: 'x' } : {}).setProtectedHeader({ alg: 'EdDSA', kid: 'test' }).setSubject(sub || '').setIssuedAt().setExpirationTime(exp).sign(key)
  const bearer = async (...a) => 'Bearer ' + (await sign(...a))

  equal('valid token: account id', await verifyAccount(await bearer('u-maman'), keys), 'u-maman')
  equal('expired token refused', await verifyAccount(await bearer('u-maman', '-1m'), keys), null)
  const other = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  equal('token signed by another key refused', await verifyAccount(await bearer('u-maman', '15m', other.privateKey), keys), null)
  equal('no token / no subject refused', [await verifyAccount(undefined, keys), await verifyAccount('Bearer x.y.z', keys), await verifyAccount(await bearer(''), keys)], [null, null, null])

  const sync = memoryStore()
  const store = memoryAccountStore(sync)
  store.users.set('u-maman', { id: 'u-maman', email: 'Maman@Example.com', emailVerified: true, name: 'Maman' })
  store.users.set('u-papa', { id: 'u-papa', email: 'papa@example.com', emailVerified: false, name: 'Papa' })
  store.users.set('u-other', { id: 'u-other', email: 'other@example.com', emailVerified: true, name: 'Other' })
  const acct = (userId, body) => handleAccount({ userId, body }, store)

  equal('signed out: refused', (await acct(null, { action: 'status' })).status, 401)
  // Maman's phone was in a code family: signing in links her account to it
  const code = newCode()
  await sync.createFamily(hashCode(code))
  let r = await acct('u-maman', { action: 'link', familyCode: code.toLowerCase() })
  equal('link with this phone\'s family code joins that household', r.body, { familyId: hashCode(code), joined: true })
  equal('linking again keeps it', (await acct('u-maman', { action: 'link' })).body.familyId, hashCode(code))
  // Papa had no family: a household is created for him
  r = await acct('u-papa', { action: 'link' })
  check('link without a code creates a household', r.body.created && sync.families.has(r.body.familyId))
  const papaHousehold = r.body.familyId

  equal('invite: bad email refused', (await acct('u-maman', { action: 'invite', email: 'nope' })).status, 400)
  equal('invite: own email refused', (await acct('u-maman', { action: 'invite', email: 'maman@example.com' })).status, 400)
  equal('invite Papa (stored lower-case)', (await acct('u-maman', { action: 'invite', email: ' Papa@Example.com ' })).status, 200)
  const status = await acct('u-papa', { action: 'status' })
  equal('Papa sees the invitation from Maman', [status.body.received.map((i) => i.from), status.body.emailVerified], [['Maman'], false])
  const inviteId = status.body.received[0].id
  equal('another verified account cannot accept it', (await acct('u-other', { action: 'accept', inviteId })).status, 404)
  equal('unverified email cannot accept (anyone could sign up with that address)', (await acct('u-papa', { action: 'accept', inviteId })).status, 403)
  store.users.get('u-papa').emailVerified = true
  r = await acct('u-papa', { action: 'accept', inviteId })
  equal('verified: joins Maman\'s household', r.body.familyId, hashCode(code))
  check('his own empty household is removed', !sync.families.has(papaHousehold))
  equal('members', (await acct('u-maman', { action: 'status' })).body.members.map((m) => [m.name, m.you]), [['Maman', true], ['Papa', false]])
  equal('invitation used up', (await acct('u-papa', { action: 'accept', inviteId })).status, 404)

  // both sync the same household through their accounts (no code), and the code still works for old phones
  await handle({ body: { action: 'sync', since: 0, changes: [{ kind: 'feed', key: 'f1', data: { id: 'f1' }, deleted: false, updatedAt: 1 }] }, familyId: await store.memberFamily('u-maman') }, sync)
  const viaAccount = await handle({ body: { action: 'sync', since: 0, changes: [] }, familyId: await store.memberFamily('u-papa') }, sync)
  const viaCode = await handle({ body: { action: 'sync', since: 0, changes: [] }, code }, sync)
  equal('sync by account and by code reach the same data', [viaAccount.body.changes.length, viaCode.body.changes.length], [1, 1])

  // leaving: the code household stays (older phones may use it); an account-made one goes when empty
  await acct('u-papa', { action: 'leave' })
  check('leaving keeps the code household for the others', sync.families.has(hashCode(code)) && (await store.memberFamily('u-papa')) === null)
  r = await acct('u-other', { action: 'link' })
  await acct('u-other', { action: 'leave' })
  check('an account-made household is removed when its last member leaves', !sync.families.has(r.body.familyId))
  const expired = await acct('u-maman', { action: 'invite', email: 'late@example.com' })
  void expired
  for (const i of store.invites.values()) i.expiresAt = 0
  equal('expired invitations are not listed', (await acct('u-maman', { action: 'status' })).body.sent, [])
}
