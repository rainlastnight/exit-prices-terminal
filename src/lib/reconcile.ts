/**
 * Reconcile exit rungs against sales that actually happened.
 *
 * A rung's `fired` flag only means the price reached that level — it says
 * nothing about whether you sold. Treating the two as the same makes the app
 * claim a sale it cannot know about, and hides the case that matters most:
 * price blew through a target and nothing was sold.
 *
 * Here the price crossing and the on-chain sells are combined into one state
 * per rung, so "reached" and "sold" stay distinguishable.
 */

export type RungState =
  /** Price has not reached this rung yet. */
  | 'pending'
  /**
   * Price reached it, but sales have not been checked yet.
   *
   * Never returned by `reconcileRungs` — it is the fallback for views that have
   * the fired flag but not the transfer history, so they can show that the
   * level was hit without claiming a sale was or was not made.
   */
  | 'reached'
  /** Price reached it and nothing was sold — the case worth shouting about. */
  | 'missed'
  /** Price reached it and some, but not all, of the tranche was sold. */
  | 'partial'
  /** The tranche was sold at or above this level. */
  | 'sold'

export interface RungInput {
  multiple: number
  price: number
  pct: number
  /** Whether price has ever crossed this rung. */
  reached: boolean
}

export interface Sell {
  /** Price the sale executed at. */
  price: number
  /** Tokens sold (positive). */
  tokens: number
  ts: number
}

export interface RungFill extends RungInput {
  targetTokens: number
  soldTokens: number
  state: RungState
}

/** A tranche counts as sold once this much of it has actually been sold. */
const SOLD_THRESHOLD = 0.9
/** Sales slightly under a rung still count toward it — fills are never exact. */
const PRICE_TOLERANCE = 0.02

export interface ReconcileResult {
  rungs: RungFill[]
  /** Share of the plan actually sold, 0..1. Weighted by tranche size. */
  soldPct: number
  /** Rungs reached with nothing sold. */
  missed: RungFill[]
}

/**
 * Match sells to rungs, highest rung first.
 *
 * Highest-first matters: a sale at 10x should be credited to the 10x tranche
 * before it is allowed to satisfy the 2x one, otherwise a single high sale
 * would mark the whole ladder complete.
 *
 * `planBalance` is the position size when the ladder was set, not the current
 * balance — selling reduces the balance, so using the live figure would shrink
 * every tranche target as the plan executed.
 */
export function reconcileRungs(
  rungs: RungInput[],
  planBalance: number,
  sells: Sell[],
): ReconcileResult {
  const byPriceDesc = [...rungs].sort((a, b) => b.price - a.price)

  // Mutable pool so each sold token is credited to at most one rung.
  const pool = sells
    .filter((s) => s.tokens > 0 && s.price > 0)
    .map((s) => ({ ...s, left: s.tokens }))
    .sort((a, b) => b.price - a.price)

  const filled: RungFill[] = byPriceDesc.map((r) => {
    const targetTokens = planBalance > 0 ? (planBalance * r.pct) / 100 : 0
    let soldTokens = 0

    if (targetTokens > 0) {
      const floor = r.price * (1 - PRICE_TOLERANCE)
      for (const s of pool) {
        if (soldTokens >= targetTokens) break
        if (s.left <= 0 || s.price < floor) continue
        const take = Math.min(s.left, targetTokens - soldTokens)
        s.left -= take
        soldTokens += take
      }
    }

    const ratio = targetTokens > 0 ? soldTokens / targetTokens : 0
    const state: RungState =
      ratio >= SOLD_THRESHOLD
        ? 'sold'
        : soldTokens > 0
          ? 'partial'
          : r.reached
            ? 'missed'
            : 'pending'

    return { ...r, targetTokens, soldTokens, state }
  })

  const totalPct = rungs.reduce((s, r) => s + r.pct, 0)
  const soldWeighted = filled.reduce((s, r) => {
    const ratio = r.targetTokens > 0 ? Math.min(1, r.soldTokens / r.targetTokens) : 0
    return s + r.pct * ratio
  }, 0)

  const ordered = filled.sort((a, b) => a.price - b.price)

  return {
    rungs: ordered,
    soldPct: totalPct > 0 ? soldWeighted / totalPct : 0,
    missed: ordered.filter((r) => r.state === 'missed'),
  }
}

/**
 * How far the cost basis has drifted from the figure a ladder was built on.
 *
 * Rung prices are frozen when a ladder is applied, so buying more later raises
 * the average cost and quietly turns "2x" into something that is no longer 2x
 * of anything. Returns null when there is nothing to compare.
 */
export function costBasisDrift(
  planBase: number | null,
  currentBase: number | null,
): { planBase: number; currentBase: number; drift: number } | null {
  if (!planBase || !currentBase || planBase <= 0 || currentBase <= 0) return null
  return { planBase, currentBase, drift: currentBase / planBase - 1 }
}

/** The base a ladder was built on, recovered from any of its rungs. */
export function planBaseFrom(rungs: Array<{ price: number; multiple: number }>): number | null {
  const r = rungs.find((x) => x.multiple > 0 && x.price > 0)
  return r ? r.price / r.multiple : null
}
