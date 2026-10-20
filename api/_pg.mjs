// Postgres (Neon) store for the sync protocol. Schema: scripts/migrate.mjs.
import { attachDatabasePool } from '@vercel/functions'
import pg from 'pg'

let pool
function getPool() {
  if (!pool) {
    // pooled connection string for request traffic (migrations use the direct one)
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    attachDatabasePool(pool)
  }
  return pool
}

export const pgStore = {
  async createFamily(hash) {
    await getPool().query('INSERT INTO families (secret_hash) VALUES ($1)', [hash])
  },

  // fixed-window counter; expired buckets are swept now and then
  async hit(bucket, max, windowSeconds) {
    const r = await getPool().query(
      `INSERT INTO rate_hits (bucket, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_hits.reset_at < now() THEN 1 ELSE rate_hits.count + 1 END,
         reset_at = CASE WHEN rate_hits.reset_at < now() THEN now() + make_interval(secs => $2) ELSE rate_hits.reset_at END
       RETURNING count`,
      [bucket, windowSeconds],
    )
    if (Math.random() < 0.01) getPool().query("DELETE FROM rate_hits WHERE reset_at < now() - interval '1 day'").catch(() => {})
    return r.rows[0].count <= max
  },

  // records go with the family (ON DELETE CASCADE)
  // ref: { hash } (family code, older apps) or { id } (resolved from a signed-in account)
  async deleteFamily(ref) {
    const r = await getPool().query(`DELETE FROM families WHERE ${ref.id ? 'id' : 'secret_hash'} = $1`, [ref.id || ref.hash])
    return r.rowCount > 0
  },

  async sync(ref, since, changes, limit) {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      // Locking the family row serialises its syncs, so sequence numbers commit in order and no client can
      // skip past a row that commits later.
      const fam = await client.query(`SELECT id FROM families WHERE ${ref.id ? 'id' : 'secret_hash'} = $1 FOR UPDATE`, [ref.id || ref.hash])
      if (fam.rowCount === 0) { await client.query('ROLLBACK'); return null }
      const familyId = fam.rows[0].id
      let inserted = []
      if (changes.length) {
        const written = await client.query(
          `INSERT INTO records (family_id, kind, key, data, deleted, updated_at, seq)
           SELECT $1, c->>'kind', c->>'key', c->'data', (c->>'deleted')::boolean, (c->>'updatedAt')::bigint, nextval('records_seq')
           FROM jsonb_array_elements($2::jsonb) AS c
           ON CONFLICT (family_id, kind, key) DO UPDATE
             SET data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, seq = excluded.seq
             WHERE records.updated_at < excluded.updated_at
           RETURNING kind, key, data, deleted, updated_at, (xmax = 0) AS inserted`,
          [familyId, JSON.stringify(changes)],
        )
        inserted = written.rows.filter((r) => r.inserted).map((r) => ({ kind: r.kind, key: r.key, data: r.data, deleted: r.deleted, updatedAt: Number(r.updated_at) }))
      }
      const rows = await client.query(
        `SELECT kind, key, data, deleted, updated_at, seq FROM records
         WHERE family_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [familyId, since, limit + 1],
      )
      await client.query('UPDATE families SET last_sync = now() WHERE id = $1', [familyId])
      await client.query('COMMIT')
      const more = rows.rows.length > limit
      const list = rows.rows.slice(0, limit)
      return {
        familyId: Number(familyId),
        inserted, // rows created by this request (not updates): bottles to tell the other parent about
        cursor: list.length ? Number(list[list.length - 1].seq) : since,
        more,
        changes: list.map((r) => ({ kind: r.kind, key: r.key, data: r.data, deleted: r.deleted, updatedAt: Number(r.updated_at) })),
      }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  },
}

// ---- Push notifications (see _push.mjs) ----

const SUB_COLS = `id, secret_hash, endpoint, p256dh, auth, family_id, lang, unit, tz, name, vitd, vitd_time, next_feed, partner, vitd_given_date`
const toSub = (r) => r && ({
  id: Number(r.id), hash: r.secret_hash, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
  familyId: r.family_id === null ? null : Number(r.family_id), lang: r.lang, unit: r.unit, tz: r.tz, name: r.name,
  vitd: r.vitd, vitdTime: r.vitd_time, nextFeed: r.next_feed, partner: r.partner, vitdGivenDate: r.vitd_given_date,
})
// JS field -> column, for partial updates
const COLUMN = {
  endpoint: 'endpoint', p256dh: 'p256dh', auth: 'auth', familyId: 'family_id', lang: 'lang', unit: 'unit', tz: 'tz', name: 'name',
  vitd: 'vitd', vitdTime: 'vitd_time', nextFeed: 'next_feed', partner: 'partner', vitdGivenDate: 'vitd_given_date',
}

async function updateSubBy(where, value, fields) {
  const keys = Object.keys(fields).filter((k) => COLUMN[k])
  if (!keys.length) {
    const r = await getPool().query(`SELECT ${SUB_COLS} FROM push_subs WHERE ${where} = $1`, [value])
    return toSub(r.rows[0])
  }
  const sets = keys.map((k, i) => `${COLUMN[k]} = $${i + 2}`).join(', ')
  const r = await getPool().query(`UPDATE push_subs SET ${sets}, updated_at = now() WHERE ${where} = $1 RETURNING ${SUB_COLS}`, [value, ...keys.map((k) => fields[k])])
  return toSub(r.rows[0])
}

export const pushStore = {
  async familyId(familyHash) {
    const r = await getPool().query('SELECT id FROM families WHERE secret_hash = $1', [familyHash])
    return r.rowCount ? Number(r.rows[0].id) : null
  },
  async getSub(hash) {
    const r = await getPool().query(`SELECT ${SUB_COLS} FROM push_subs WHERE secret_hash = $1`, [hash])
    return toSub(r.rows[0]) || null
  },
  async getSubById(id) {
    const r = await getPool().query(`SELECT ${SUB_COLS} FROM push_subs WHERE id = $1`, [id])
    return toSub(r.rows[0]) || null
  },
  async upsertSub(hash, fields) {
    await getPool().query(
      `INSERT INTO push_subs (secret_hash, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (secret_hash) DO NOTHING`,
      [hash, fields.endpoint, fields.p256dh, fields.auth],
    )
    return updateSubBy('secret_hash', hash, fields)
  },
  updateSub: (hash, fields) => updateSubBy('secret_hash', hash, fields),
  async deleteSub(hash) { await getPool().query('DELETE FROM push_subs WHERE secret_hash = $1', [hash]) },
  async deleteSubById(id) { await getPool().query('DELETE FROM push_subs WHERE id = $1', [id]) },
  async familySubs(familyId) {
    const r = await getPool().query(`SELECT ${SUB_COLS} FROM push_subs WHERE family_id = $1`, [familyId])
    return r.rows.map(toSub)
  },
  // the "next bottle" state lives on the family (shared) or on the device (alone)
  async getNext(scope) {
    const [table, id] = scope.familyId ? ['families', scope.familyId] : ['push_subs', scope.subId]
    const r = await getPool().query(`SELECT next_last_feed_at, next_feed_at, next_msg_id FROM ${table} WHERE id = $1`, [id])
    const row = r.rows[0]
    if (!row || row.next_feed_at === null) return null
    return { lastFeedAt: Number(row.next_last_feed_at), nextFeedAt: Number(row.next_feed_at), msgId: row.next_msg_id }
  },
  async setNext(scope, v) {
    const [table, id] = scope.familyId ? ['families', scope.familyId] : ['push_subs', scope.subId]
    await getPool().query(`UPDATE ${table} SET next_last_feed_at = $2, next_feed_at = $3, next_msg_id = $4 WHERE id = $1`, [id, v.lastFeedAt, v.nextFeedAt, v.msgId])
  },
  // given to every baby of the family that day: the first baby ("daily") and each other profile ("day")
  async familyVitdGiven(familyId, date) {
    const r = await getPool().query(
      `SELECT
         EXISTS (SELECT 1 FROM records WHERE family_id = $1 AND kind = 'daily' AND key = $2 AND NOT deleted AND (data->>'vitaminD')::boolean) AS first,
         (SELECT count(*) FROM records p WHERE p.family_id = $1 AND p.kind = 'profile' AND p.key <> 'b1' AND NOT p.deleted
            AND NOT EXISTS (SELECT 1 FROM records d WHERE d.family_id = $1 AND d.kind = 'day' AND d.key = p.key || '|' || $2
                            AND NOT d.deleted AND (d.data->>'vitaminD')::boolean)) AS missing`,
      [familyId, date],
    )
    return r.rows[0].first && Number(r.rows[0].missing) === 0
  },
  // baby names by id, when the family has more than one baby (otherwise notifications don't name it)
  async familyBabyNames(familyId) {
    const r = await getPool().query(`SELECT key, data FROM records WHERE family_id = $1 AND kind = 'profile' AND NOT deleted`, [familyId])
    const names = Object.fromEntries(r.rows.map((x) => [x.key, (x.data && x.data.name) || '']))
    return Object.keys(names).some((k) => k !== 'b1') ? names : {}
  },
  async familyLastFeedAt(familyId) {
    const r = await getPool().query(
      `SELECT max((extract(epoch FROM (data->>'time')::timestamptz) * 1000)::bigint) AS last
       FROM records WHERE family_id = $1 AND kind IN ('feed', 'bfeed') AND NOT deleted`,
      [familyId],
    )
    return Number(r.rows[0].last) || 0
  },
}

// ---- Accounts and households (see _account.mjs). Accounts live in Neon Auth's neon_auth."user". ----

export const accountStore = {
  async getUser(userId) {
    const r = await getPool().query('SELECT id, email, "emailVerified" AS verified, name FROM neon_auth."user" WHERE id = $1', [userId])
    const u = r.rows[0]
    return u ? { id: u.id, email: u.email, emailVerified: u.verified, name: u.name } : null
  },
  async memberFamily(userId) {
    const r = await getPool().query('SELECT family_id FROM family_members WHERE user_id = $1', [userId])
    return r.rowCount ? Number(r.rows[0].family_id) : null
  },
  async addMember(userId, familyId) {
    await getPool().query('INSERT INTO family_members (user_id, family_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET family_id = excluded.family_id', [userId, familyId])
  },
  async removeMember(userId) { await getPool().query('DELETE FROM family_members WHERE user_id = $1', [userId]) },
  async familyMembers(familyId) {
    const r = await getPool().query(
      'SELECT m.user_id, u.email, u.name FROM family_members m JOIN neon_auth."user" u ON u.id = m.user_id WHERE m.family_id = $1 ORDER BY m.created_at',
      [familyId],
    )
    return r.rows.map((x) => ({ userId: x.user_id, email: x.email, name: x.name }))
  },
  async familyIdByHash(hash) {
    const r = await getPool().query('SELECT id FROM families WHERE secret_hash = $1', [hash])
    return r.rowCount ? Number(r.rows[0].id) : null
  },
  async createAccountFamily(hash) {
    const r = await getPool().query('INSERT INTO families (secret_hash, via_account) VALUES ($1, true) RETURNING id', [hash])
    return Number(r.rows[0].id)
  },
  // only households created for accounts (never a code family, which older phones may still use)
  async deleteFamilyIfOrphan(familyId) {
    await getPool().query('DELETE FROM families f WHERE f.id = $1 AND f.via_account AND NOT EXISTS (SELECT 1 FROM family_members m WHERE m.family_id = f.id)', [familyId])
  },
  async upsertInvite(familyId, email, invitedBy, expiresAt) {
    await getPool().query(
      `INSERT INTO family_invites (family_id, email, invited_by, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (family_id, email) DO UPDATE SET invited_by = excluded.invited_by, expires_at = excluded.expires_at, created_at = now()`,
      [familyId, email, invitedBy, expiresAt],
    )
  },
  async getInvite(id) {
    const r = await getPool().query('SELECT id, family_id, email, expires_at FROM family_invites WHERE id = $1', [id])
    const x = r.rows[0]
    return x ? { id: Number(x.id), familyId: Number(x.family_id), email: x.email, expiresAt: new Date(x.expires_at).getTime() } : null
  },
  async deleteInvite(id) { await getPool().query('DELETE FROM family_invites WHERE id = $1', [id]) },
  async sentInvites(familyId, now) {
    const r = await getPool().query('SELECT id, email FROM family_invites WHERE family_id = $1 AND expires_at > $2 ORDER BY created_at', [familyId, new Date(now)])
    return r.rows.map((x) => ({ id: Number(x.id), email: x.email }))
  },
  async invitesFor(email, now) {
    const r = await getPool().query(
      `SELECT i.id, i.family_id, u.name, u.email FROM family_invites i LEFT JOIN neon_auth."user" u ON u.id = i.invited_by
       WHERE i.email = $1 AND i.expires_at > $2 ORDER BY i.created_at`,
      [email, new Date(now)],
    )
    return r.rows.map((x) => ({ id: Number(x.id), familyId: Number(x.family_id), fromName: x.name, fromEmail: x.email }))
  },
}
