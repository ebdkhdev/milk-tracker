// Creates or updates the sharing schema. Idempotent; uses the direct (unpooled) connection.
// Run with: node --env-file=.env.local scripts/migrate.mjs
import pg from 'pg'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL_UNPOOLED is not set (vercel env pull)'); process.exit(1) }
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query(`
  CREATE TABLE IF NOT EXISTS families (
    id bigserial PRIMARY KEY,
    secret_hash text NOT NULL UNIQUE,      -- sha256 of the family code; the code itself is never stored
    created_at timestamptz NOT NULL DEFAULT now(),
    last_sync timestamptz
  );
  CREATE SEQUENCE IF NOT EXISTS records_seq;
  CREATE TABLE IF NOT EXISTS records (
    family_id bigint NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('feed', 'daily', 'baby')),
    key text NOT NULL,
    data jsonb,                            -- null for a deletion (tombstone)
    deleted boolean NOT NULL DEFAULT false,
    updated_at bigint NOT NULL,            -- client modification time (ms), last write wins
    seq bigint NOT NULL,                   -- per-write order, the clients' pull cursor
    PRIMARY KEY (family_id, kind, key)
  );
  CREATE INDEX IF NOT EXISTS records_family_seq ON records (family_id, seq);
  CREATE TABLE IF NOT EXISTS rate_hits (
    bucket text PRIMARY KEY,               -- kind + hash (IPs are never stored in clear)
    count int NOT NULL,
    reset_at timestamptz NOT NULL
  );
`)
console.log('schema ok')
await client.end()
