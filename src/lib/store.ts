import { getDb } from './db'
import { shouldRearm, type RuleMetric } from './rules'

export interface WalletRow {
  id: number
  address: string
  label: string | null
  added_at: number
}

export interface TrackedRow {
  id: number
  wallet_id: number
  chain_id: number
  token_address: string
  symbol: string | null
  name: string | null
  decimals: number
  icon_url: string | null
  balance_raw: string | null
  total_supply: string | null
  circulating_supply: number | null
  supply_at: number | null
  avg_cost: number | null
  avg_cost_manual: number | null
  realized_pnl: number | null
  cost_at: number | null
  cost_partial: number | null
  template_id: string | null
  plan_balance: number | null
  balance_at: number | null
  pool_address: string | null
  pool_liquidity: number | null
  rule_metric: RuleMetric
  target_up: number | null
  stop_down: number | null
  fired_up: number
  fired_down: number
  last_price: number | null
  last_fdv: number | null
  last_mc: number | null
  last_price_at: number | null
  created_at: number
}

export interface AlertRow {
  id: number
  tracked_id: number
  direction: 'up' | 'down'
  metric: string
  threshold: number
  value: number
  ts: number
  seen: number
  symbol: string | null
  chain_id: number
}

/* ---------------------------------------------------------------- wallets */

export function listWallets(): WalletRow[] {
  return getDb().prepare('SELECT * FROM wallets ORDER BY added_at DESC').all() as WalletRow[]
}

export function addWallet(address: string, label?: string): WalletRow {
  const db = getDb()
  const normalized = address.toLowerCase()
  db.prepare(
    `INSERT INTO wallets (address, label, added_at) VALUES (?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET label = COALESCE(excluded.label, wallets.label)`,
  ).run(normalized, label ?? null, Date.now())
  return db.prepare('SELECT * FROM wallets WHERE address = ?').get(normalized) as WalletRow
}

export function deleteWallet(id: number): void {
  getDb().prepare('DELETE FROM wallets WHERE id = ?').run(id)
}

/* ---------------------------------------------------------------- tracked */

export function listTracked(walletId?: number): TrackedRow[] {
  const db = getDb()
  return (
    walletId
      ? db.prepare('SELECT * FROM tracked WHERE wallet_id = ? ORDER BY created_at').all(walletId)
      : db.prepare('SELECT * FROM tracked ORDER BY created_at').all()
  ) as TrackedRow[]
}

export function getTracked(id: number): TrackedRow | undefined {
  return getDb().prepare('SELECT * FROM tracked WHERE id = ?').get(id) as TrackedRow | undefined
}

export interface TrackInput {
  walletId: number
  chainId: number
  tokenAddress: string
  symbol?: string | null
  name?: string | null
  decimals?: number
  iconUrl?: string | null
  balanceRaw?: string | null
}

export function addTracked(input: TrackInput): TrackedRow {
  const db = getDb()
  const addr = input.tokenAddress.toLowerCase()
  db.prepare(
    `INSERT INTO tracked
       (wallet_id, chain_id, token_address, symbol, name, decimals, icon_url, balance_raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(wallet_id, chain_id, token_address) DO UPDATE SET
       balance_raw = excluded.balance_raw,
       symbol      = COALESCE(excluded.symbol, tracked.symbol),
       icon_url    = COALESCE(excluded.icon_url, tracked.icon_url)`,
  ).run(
    input.walletId,
    input.chainId,
    addr,
    input.symbol ?? null,
    input.name ?? null,
    input.decimals ?? 18,
    input.iconUrl ?? null,
    input.balanceRaw ?? null,
    Date.now(),
  )

  return db
    .prepare('SELECT * FROM tracked WHERE wallet_id = ? AND chain_id = ? AND token_address = ?')
    .get(input.walletId, input.chainId, addr) as TrackedRow
}

export function untrack(id: number): void {
  getDb().prepare('DELETE FROM tracked WHERE id = ?').run(id)
}

export interface RuleUpdate {
  metric?: RuleMetric
  targetUp?: number | null
  stopDown?: number | null
}

/**
 * Update a row's exit rule, clearing the latch for whichever legs changed so an
 * edited threshold can fire again.
 */
export function updateRule(id: number, update: RuleUpdate): TrackedRow | undefined {
  const db = getDb()
  const current = getTracked(id)
  if (!current) return undefined

  const next = {
    metric: update.metric ?? current.rule_metric,
    targetUp: update.targetUp !== undefined ? update.targetUp : current.target_up,
    stopDown: update.stopDown !== undefined ? update.stopDown : current.stop_down,
  }

  const rearm = shouldRearm(
    { metric: current.rule_metric, targetUp: current.target_up, stopDown: current.stop_down },
    next,
  )

  db.prepare(
    `UPDATE tracked SET
       rule_metric = ?, target_up = ?, stop_down = ?,
       fired_up   = CASE WHEN ? THEN 0 ELSE fired_up   END,
       fired_down = CASE WHEN ? THEN 0 ELSE fired_down END
     WHERE id = ?`,
  ).run(next.metric, next.targetUp, next.stopDown, rearm.up ? 1 : 0, rearm.down ? 1 : 0, id)

  return getTracked(id)
}

export function recordPrice(
  id: number,
  price: number | null,
  fdv: number | null,
  mc: number | null,
  extra: {
    totalSupply?: number | null
    circulatingSupply?: number | null
    poolAddress?: string | null
    poolLiquidity?: number | null
  } = {},
): void {
  const db = getDb()
  const now = Date.now()

  db.prepare(
    `UPDATE tracked SET
       last_price = ?, last_fdv = ?, last_mc = ?, last_price_at = ?,
       total_supply       = COALESCE(?, total_supply),
       circulating_supply = COALESCE(?, circulating_supply),
       supply_at          = CASE WHEN ? IS NOT NULL THEN ? ELSE supply_at END,
       pool_address       = COALESCE(?, pool_address),
       pool_liquidity     = COALESCE(?, pool_liquidity)
     WHERE id = ?`,
  ).run(
    price,
    fdv,
    mc,
    now,
    extra.totalSupply != null ? String(extra.totalSupply) : null,
    extra.circulatingSupply ?? null,
    extra.totalSupply != null ? 1 : null,
    now,
    extra.poolAddress ?? null,
    extra.poolLiquidity ?? null,
    id,
  )

  if (price !== null) {
    db.prepare('INSERT INTO price_history (tracked_id, price, fdv, ts) VALUES (?, ?, ?, ?)').run(
      id,
      price,
      fdv,
      now,
    )
  }
}

export function latchFired(id: number, direction: 'up' | 'down'): void {
  const col = direction === 'up' ? 'fired_up' : 'fired_down'
  getDb().prepare(`UPDATE tracked SET ${col} = 1 WHERE id = ?`).run(id)
}

/* --------------------------------------------------------------- tranches */

export interface TrancheRow {
  id: number
  tracked_id: number
  multiple: number
  pct: number
  price: number
  fired: number
  fired_at: number | null
  sort: number
  /** Last reconciled state; null until the position has been opened. */
  state: string | null
}

export function listTranches(trackedId: number): TrancheRow[] {
  return getDb()
    .prepare('SELECT * FROM tranches WHERE tracked_id = ? ORDER BY sort, price')
    .all(trackedId) as TrancheRow[]
}

export function listAllTranches(): TrancheRow[] {
  return getDb().prepare('SELECT * FROM tranches ORDER BY tracked_id, sort').all() as TrancheRow[]
}

/** Replace a position's ladder wholesale. Any previous fired state is dropped
 *  along with the old rows, which is the intended re-arm on a new template. */
export function setTranches(
  trackedId: number,
  specs: Array<{ multiple: number; pct: number; price: number }>,
  templateId: string | null,
  planBalance: number | null,
): TrancheRow[] {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tranches WHERE tracked_id = ?').run(trackedId)
    const insert = db.prepare(
      'INSERT INTO tranches (tracked_id, multiple, pct, price, sort) VALUES (?, ?, ?, ?, ?)',
    )
    specs.forEach((s, i) => insert.run(trackedId, s.multiple, s.pct, s.price, i))
    db.prepare('UPDATE tracked SET template_id = ?, plan_balance = ? WHERE id = ?').run(
      templateId,
      planBalance,
      trackedId,
    )
  })
  tx()
  return listTranches(trackedId)
}

export function clearTranches(trackedId: number): void {
  const db = getDb()
  db.prepare('DELETE FROM tranches WHERE tracked_id = ?').run(trackedId)
  db.prepare('UPDATE tracked SET template_id = NULL WHERE id = ?').run(trackedId)
}

/** Refresh a tracked token's on-chain balance. */
export function updateBalance(id: number, balanceRaw: string): void {
  getDb()
    .prepare('UPDATE tracked SET balance_raw = ?, balance_at = ? WHERE id = ?')
    .run(balanceRaw, Date.now(), id)
}

/** Persist reconciled rung states so the row list can render them too. */
export function saveTrancheStates(states: Array<{ id: number; state: string }>): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE tranches SET state = ? WHERE id = ?')
  db.transaction(() => {
    for (const s of states) stmt.run(s.state, s.id)
  })()
}

export function latchTranche(id: number): void {
  getDb()
    .prepare("UPDATE tranches SET fired = 1, fired_at = ?, state = 'reached' WHERE id = ?")
    .run(Date.now(), id)
}

/* ------------------------------------------------------------- cost basis */

export function saveCostBasis(
  id: number,
  data: { avgCost: number | null; realizedPnl: number; partial: boolean },
): void {
  getDb()
    .prepare(
      `UPDATE tracked SET avg_cost = ?, realized_pnl = ?, cost_partial = ?, cost_at = ? WHERE id = ?`,
    )
    .run(data.avgCost, data.realizedPnl, data.partial ? 1 : 0, Date.now(), id)
}

export function setManualCost(id: number, value: number | null): void {
  getDb().prepare('UPDATE tracked SET avg_cost_manual = ? WHERE id = ?').run(value, id)
}

/** Manual override always wins over the estimate. */
export function effectiveCost(row: Pick<TrackedRow, 'avg_cost' | 'avg_cost_manual'>): number | null {
  return row.avg_cost_manual ?? row.avg_cost ?? null
}

/* ----------------------------------------------------------------- alerts */

export function recordAlert(
  trackedId: number,
  direction: 'up' | 'down',
  metric: string,
  threshold: number,
  value: number,
): void {
  getDb()
    .prepare(
      'INSERT INTO alerts (tracked_id, direction, metric, threshold, value, ts) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(trackedId, direction, metric, threshold, value, Date.now())
}

export function listAlerts(limit = 50): AlertRow[] {
  return getDb()
    .prepare(
      `SELECT a.*, t.symbol, t.chain_id
       FROM alerts a JOIN tracked t ON t.id = a.tracked_id
       ORDER BY a.ts DESC LIMIT ?`,
    )
    .all(limit) as AlertRow[]
}

export function markAlertsSeen(): void {
  getDb().prepare('UPDATE alerts SET seen = 1 WHERE seen = 0').run()
}
