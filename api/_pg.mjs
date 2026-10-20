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
      if (changes.length) {
        await client.query(
          `INSERT INTO records (family_id, kind, key, data, deleted, updated_at, seq)
           SELECT $1, c->>'kind', c->>'key', c->'data', (c->>'deleted')::boolean, (c->>'updatedAt')::bigint, nextval('records_seq')
           FROM jsonb_array_elements($2::jsonb) AS c
           ON CONFLICT (family_id, kind, key) DO UPDATE
             SET data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, seq = excluded.seq
             WHERE records.updated_at < excluded.updated_at`,
          [familyId, JSON.stringify(changes)],
        )
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
