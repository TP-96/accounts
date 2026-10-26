// Postgres everywhere:
//  - DATABASE_URL / POSTGRES_URL set (Vercel + Neon)  -> node-postgres connection pool
//  - otherwise (local dev, tests)                      -> PGlite, an embedded Postgres stored in DATA_DIR
// Queries are written with `?` placeholders and converted to $1, $2… here.
import fs from 'node:fs';
import path from 'node:path';

export const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

const SCHEMA = `
CREATE OR REPLACE FUNCTION now_iso() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

CREATE TABLE IF NOT EXISTS households (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'CAD',
  created_at TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  household_id INTEGER REFERENCES households(id),
  color TEXT NOT NULL DEFAULT '#6d5efc',
  email_notifications INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE IF NOT EXISTS recurring_bills (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  template TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly')),
  next_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE IF NOT EXISTS bills (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_by INTEGER NOT NULL REFERENCES users(id),
  split_type TEXT NOT NULL CHECK (split_type IN ('equal','exact','percent')),
  date TEXT NOT NULL,
  recurring_id INTEGER REFERENCES recurring_bills(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT now_iso(),
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS bill_shares (
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  percent DOUBLE PRECISION,
  PRIMARY KEY (bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  from_user INTEGER NOT NULL REFERENCES users(id),
  to_user INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'other',
  bill_id INTEGER REFERENCES bills(id),
  date TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT now_iso(),
  deleted_at TEXT,
  CHECK (from_user <> to_user)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now_iso()
);

CREATE INDEX IF NOT EXISTS idx_bills_household ON bills(household_id, date);
CREATE INDEX IF NOT EXISTS idx_payments_household ON payments(household_id, date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_activity_household ON activity(household_id, id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS former_household_id INTEGER REFERENCES households(id);
`;

/** "a = ? AND b = ?" -> "a = $1 AND b = $2" (skips ? inside quoted strings). */
function toPg(sql) {
  let n = 0;
  let out = '';
  let quote = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') out += `$${++n}`;
    else out += ch;
  }
  return out;
}

let driver = null; // { query(text, params) -> {rows, affectedRows}, transaction(fn) }
let ready = null;

async function connect() {
  if (DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 3), // serverless: keep per-instance pools small
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
      idleTimeoutMillis: 10_000,
    });
    // Neon closes idle connections; without this listener that would crash the process.
    pool.on('error', (err) => console.warn('[db] idle connection closed:', err.message));
    const wrap = (c) => async (text, params) => {
      const r = await c.query(text, params);
      return { rows: r.rows, affectedRows: r.rowCount };
    };
    const transient = (e) => /terminated|ECONNRESET|Connection ended|timeout/i.test(e?.message || '');
    const poolQuery = wrap(pool);
    return {
      // Read-only queries are retried once on a dropped connection (safe: they change nothing).
      async query(text, params) {
        try {
          return await poolQuery(text, params);
        } catch (e) {
          if (transient(e) && /^\s*SELECT\b/i.test(text)) return poolQuery(text, params);
          throw e;
        }
      },
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(wrap(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set (Vercel needs a hosted Postgres such as Neon)');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.DB_MEMORY === '1' ? undefined : path.join(DATA_DIR, 'pg');
  if (dir) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = await PGlite.create(dir);
  const wrap = (c) => async (text, params) => {
    const r = await c.query(text, params);
    return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
  };
  return {
    query: wrap(db),
    transaction: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  };
}

/** Connect and create tables once per process (safe to call from every request). */
export function init() {
  if (!ready) {
    ready = (async () => {
      driver = await connect();
      await driver.query(`SELECT pg_advisory_lock(424242)`).catch(() => {});
      try {
        for (const stmt of SCHEMA.split(/;\s*\n(?=\s*(?:CREATE|ALTER))/)) await driver.query(stmt);
      } finally {
        await driver.query(`SELECT pg_advisory_unlock(424242)`).catch(() => {});
      }
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

export async function close() {
  if (driver) await driver.close();
  driver = null;
  ready = null;
}

function makeQ(run) {
  return {
    get: async (sql, ...params) => (await run(toPg(sql), params)).rows[0],
    all: async (sql, ...params) => (await run(toPg(sql), params)).rows,
    run: async (sql, ...params) => run(toPg(sql), params),
  };
}

/** q.get/all/run(sql, ...params). Use `INSERT ... RETURNING id` to get new ids. */
export const q = makeQ(async (text, params) => {
  await init();
  return driver.query(text, params);
});

/** Run fn(tq) in a transaction; tq has the same get/all/run API. */
export async function tx(fn) {
  await init();
  return driver.transaction((run) => fn(makeQ(run)));
}
