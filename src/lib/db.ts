import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DB_PATH = process.env.EXIT_PRICES_DB ?? join(process.cwd(), 'data', 'exit-prices.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  addColumns(db)
  _db = db
  return db
}

/** Idempotent column additions, so an existing dev DB upgrades in place. */
function addColumns(db: Database.Database) {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(tracked)').all() as Array<{ name: string }>).map((c) => c.name),
  )
  const wanted: Array<[string, string]> = [
    ['circulating_supply', 'REAL'],
    ['supply_at', 'INTEGER'],
    // Cost basis: auto-estimated from transfers, or overridden by the user.
    ['avg_cost', 'REAL'],
    ['avg_cost_manual', 'REAL'],
    ['realized_pnl', 'REAL'],
    ['cost_at', 'INTEGER'],
    ['cost_partial', 'INTEGER'],
    ['template_id', 'TEXT'],
    // Position size when the ladder was applied. Tranche targets are sized
    // from this, not the live balance — otherwise selling shrinks every target
    // and a half-executed plan keeps looking complete.
    ['plan_balance', 'REAL'],
    ['balance_at', 'INTEGER'],
  ]
  for (const [name, type] of wanted) {
    if (!columns.has(name)) db.exec(`ALTER TABLE tracked ADD COLUMN ${name} ${type}`)
  }
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id       INTEGER PRIMARY KEY,
      address  TEXT NOT NULL,
      label    TEXT,
      added_at INTEGER NOT NULL,
      UNIQUE(address)
    );

    CREATE TABLE IF NOT EXISTS tracked (
      id            INTEGER PRIMARY KEY,
      wallet_id     INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      chain_id      INTEGER NOT NULL,
      token_address TEXT    NOT NULL,
      symbol        TEXT,
      name          TEXT,
      decimals      INTEGER NOT NULL DEFAULT 18,
      icon_url      TEXT,
      balance_raw   TEXT,
      total_supply  TEXT,
      pool_address  TEXT,
      pool_liquidity REAL,
      rule_metric   TEXT NOT NULL DEFAULT 'price' CHECK(rule_metric IN ('price','fdv')),
      target_up     REAL,
      stop_down     REAL,
      fired_up      INTEGER NOT NULL DEFAULT 0,
      fired_down    INTEGER NOT NULL DEFAULT 0,
      last_price    REAL,
      last_fdv      REAL,
      last_mc       REAL,
      last_price_at INTEGER,
      created_at    INTEGER NOT NULL,
      UNIQUE(wallet_id, chain_id, token_address)
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id         INTEGER PRIMARY KEY,
      tracked_id INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
      price      REAL NOT NULL,
      fdv        REAL,
      ts         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ph_tracked_ts ON price_history(tracked_id, ts);

    CREATE TABLE IF NOT EXISTS api_cache (
      key        TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expiry ON api_cache(expires_at);

    -- Multi-tranche exit ladders. Prices are stored concrete so an updated
    -- cost basis never silently moves a target the user already set.
    CREATE TABLE IF NOT EXISTS tranches (
      id         INTEGER PRIMARY KEY,
      tracked_id INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
      multiple   REAL NOT NULL,
      pct        REAL NOT NULL,
      price      REAL NOT NULL,
      fired      INTEGER NOT NULL DEFAULT 0,
      fired_at   INTEGER,
      sort       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tranches_tracked ON tranches(tracked_id, sort);

    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY,
      tracked_id INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
      direction  TEXT NOT NULL CHECK(direction IN ('up','down')),
      metric     TEXT NOT NULL,
      threshold  REAL NOT NULL,
      value      REAL NOT NULL,
      ts         INTEGER NOT NULL,
      seen       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts DESC);
  `)
}
