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
    kind text NOT NULL,
    key text NOT NULL,
    data jsonb,                            -- null for a deletion (tombstone)
    deleted boolean NOT NULL DEFAULT false,
    updated_at bigint NOT NULL,            -- client modification time (ms), last write wins
    seq bigint NOT NULL,                   -- per-write order, the clients' pull cursor
    PRIMARY KEY (family_id, kind, key)
  );
  CREATE INDEX IF NOT EXISTS records_family_seq ON records (family_id, seq);
  -- kinds allowed (v2.9: other babies, profiles, events); the constraint is replaced so older schemas upgrade
  ALTER TABLE records DROP CONSTRAINT IF EXISTS records_kind_check;
  ALTER TABLE records ADD CONSTRAINT records_kind_check CHECK (kind IN ('feed', 'daily', 'baby', 'bfeed', 'day', 'profile', 'event'));
  -- push notifications: one row per phone that enabled them
  CREATE TABLE IF NOT EXISTS push_subs (
    id bigserial PRIMARY KEY,
    secret_hash text NOT NULL UNIQUE,      -- sha256 of the device token kept by the phone
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    family_id bigint REFERENCES families(id) ON DELETE SET NULL,
    lang text NOT NULL DEFAULT 'fr',
    unit text NOT NULL DEFAULT 'ml',
    tz text NOT NULL DEFAULT 'Europe/Paris',
    name text,
    vitd boolean NOT NULL DEFAULT false,
    vitd_time text NOT NULL DEFAULT '08:00',
    next_feed boolean NOT NULL DEFAULT false,
    partner boolean NOT NULL DEFAULT false,
    vitd_given_date text,                  -- local date when vitamin D was last given (phones outside a family)
    next_last_feed_at bigint, next_feed_at bigint, next_msg_id text,   -- "next bottle" for a phone alone
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS push_subs_family ON push_subs (family_id);
  -- "next bottle" for a family: one message for every opted-in phone
  ALTER TABLE families ADD COLUMN IF NOT EXISTS next_last_feed_at bigint;
  ALTER TABLE families ADD COLUMN IF NOT EXISTS next_feed_at bigint;
  ALTER TABLE families ADD COLUMN IF NOT EXISTS next_msg_id text;
  -- accounts (Neon Auth) and households: one household per account, invitations by email
  ALTER TABLE families ADD COLUMN IF NOT EXISTS via_account boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS family_members (
    user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
    family_id bigint NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS family_members_family ON family_members (family_id);
  CREATE TABLE IF NOT EXISTS family_invites (
    id bigserial PRIMARY KEY,
    family_id bigint NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    email text NOT NULL,                     -- lower-case; accepted only by a verified account with this email
    invited_by uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    UNIQUE (family_id, email)
  );
  CREATE INDEX IF NOT EXISTS family_invites_email ON family_invites (email);
  CREATE TABLE IF NOT EXISTS rate_hits (
    bucket text PRIMARY KEY,               -- kind + hash (IPs are never stored in clear)
    count int NOT NULL,
    reset_at timestamptz NOT NULL
  );
`)
console.log('schema ok')
await client.end()
