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
  async deleteFamily(hash) {
    const r = await getPool().query('DELETE FROM families WHERE secret_hash = $1', [hash])
    return r.rowCount > 0
  },

  async sync(hash, since, changes, limit) {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      // Locking the family row serialises its syncs, so sequence numbers commit in order and no client can
      // skip past a row that commits later.
      const fam = await client.query('SELECT id FROM families WHERE secret_hash = $1 FOR UPDATE', [hash])
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
  async familyVitdGiven(familyId, date) {
    const r = await getPool().query(
      `SELECT 1 FROM records WHERE family_id = $1 AND kind = 'daily' AND key = $2 AND NOT deleted AND (data->>'vitaminD')::boolean`,
      [familyId, date],
    )
    return r.rowCount > 0
  },
  async familyLastFeedAt(familyId) {
    const r = await getPool().query(
      `SELECT max((extract(epoch FROM (data->>'time')::timestamptz) * 1000)::bigint) AS last
       FROM records WHERE family_id = $1 AND kind = 'feed' AND NOT deleted`,
      [familyId],
    )
    return Number(r.rows[0].last) || 0
  },
}
