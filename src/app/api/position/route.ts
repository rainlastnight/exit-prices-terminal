import { NextResponse } from 'next/server'
import {
  getTracked,
  listTranches,
  saveCostBasis,
  saveTrancheStates,
  listWallets,
  recordPrice,
} from '@/lib/store'
import { getTokenTransfers } from '@/lib/blockscout'
import { getBestPool, getCandles } from '@/lib/geckoterminal'
import { candlesForHistory, computeCostBasis, computePnl } from '@/lib/costbasis'
import { analyzeHistory, resolveLadder, suggestTemplate, TEMPLATES } from '@/lib/templates'
import { isChainId } from '@/lib/chains'
import { reconcileRungs, costBasisDrift, planBaseFrom } from '@/lib/reconcile'

export const dynamic = 'force-dynamic'

/**
 * Everything the detail panel needs for one position: cost basis, PNL, the
 * wallet's own trades (for chart markers), the resolved exit ladder, and a
 * template recommendation derived from the token's actual history.
 */
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const row = getTracked(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isChainId(row.chain_id)) return NextResponse.json({ error: 'Bad chain' }, { status: 400 })

  const wallet = listWallets().find((w) => w.id === row.wallet_id)
  const balance = row.balance_raw ? Number(row.balance_raw) / 10 ** row.decimals : 0
  const isNative = row.token_address === 'native'

  /* Pool — needed for candles, historical pricing, and the liquidity figure
     that decides whether a long ladder is even fillable. Always resolve it:
     relying on the stored value leaves liquidity null until the chart happens
     to have been opened, which would silently disable the thin-liquidity guard
     in the suggestion. */
  let poolAddress = row.pool_address
  let poolLiquidity = row.pool_liquidity

  if (!isNative && (!poolAddress || poolLiquidity == null)) {
    const pool = await getBestPool(row.chain_id, row.token_address).catch(() => null)
    if (pool) {
      poolAddress = pool.address
      poolLiquidity = pool.liquidityUsd
      recordPrice(id, row.last_price, row.last_fdv, row.last_mc, {
        poolAddress,
        poolLiquidity,
      })
    }
  }

  /* Transfers + candles, in parallel where possible. */
  const transfers =
    wallet && !isNative
      ? await getTokenTransfers(row.chain_id, wallet.address, row.token_address).catch(() => [])
      : []

  const [historyCandles, chartCandles] = await Promise.all([
    poolAddress ? candlesForHistory(row.chain_id, poolAddress, transfers).catch(() => []) : [],
    poolAddress ? getCandles(row.chain_id, poolAddress, 'day', 365).catch(() => []) : [],
  ])

  /* Cost basis. The manual override wins outright when present. */
  const basis = computeCostBasis(transfers, historyCandles)
  if (transfers.length > 0) {
    saveCostBasis(id, {
      avgCost: basis.avgCost,
      realizedPnl: basis.realizedPnl,
      partial: basis.partial,
    })
  }

  const avgCost = row.avg_cost_manual ?? basis.avgCost ?? row.avg_cost ?? null
  const pnl = computePnl(balance, row.last_price, avgCost, basis.realizedPnl)

  /* Ladder + suggestion. */
  const tranches = listTranches(id)
  const firedMultiples = tranches.filter((t) => t.fired === 1).map((t) => t.multiple)

  // "2x" means twice what was paid; without a buy history the current price is
  // the only sensible base.
  const base = avgCost ?? row.last_price ?? 0
  const ladder =
    tranches.length > 0
      ? resolveLadder(
          tranches.map((t) => ({ multiple: t.multiple, pct: t.pct })),
          base,
          balance,
          row.last_price,
          avgCost,
          firedMultiples,
        )
      : null

  /* Reconcile the ladder against sales that actually happened. A rung's fired
     flag only means price reached it; pairing that with real sells separates
     "hit and sold" from "hit and missed". */
  const sells = basis.trades
    .filter((t) => t.kind === 'sell' && t.price !== null)
    .map((t) => ({ price: t.price as number, tokens: Math.abs(t.amount), ts: t.ts }))

  const planBalance = row.plan_balance ?? balance
  const fills = reconcileRungs(
    tranches.map((t) => ({
      multiple: t.multiple,
      price: t.price,
      pct: t.pct,
      reached: t.fired === 1,
    })),
    planBalance,
    sells,
  )

  /* Persist what reconciliation found, so the collapsed row list can colour
     rungs by the real outcome instead of falling back to the fired flag. */
  if (tranches.length > 0) {
    const byPrice = new Map(fills.rungs.map((f) => [f.price, f.state]))
    const updates: Array<{ id: number; state: string }> = []
    for (const t of tranches) {
      const state = byPrice.get(t.price)
      if (state) updates.push({ id: t.id, state })
    }
    saveTrancheStates(updates)
  }

  // Rung prices are frozen at apply time, so a later buy that lifts the average
  // cost quietly makes "2x" no longer 2x of anything.
  const drift = costBasisDrift(planBaseFrom(tranches), avgCost)

  const stats = analyzeHistory(
    (chartCandles.length > 0 ? chartCandles : historyCandles).map((c) => ({
      time: c.time,
      close: c.close,
      high: c.high,
      low: c.low,
    })),
    poolLiquidity,
  )
  const suggestion = suggestTemplate(stats)

  /* Previews so the UI can show what each template would produce. */
  const previews = Object.values(TEMPLATES).map((t) => ({
    id: t.id,
    name: t.name,
    blurb: t.blurb,
    summary: resolveLadder(t.tranches, base, balance, row.last_price, avgCost),
  }))

  return NextResponse.json({
    id,
    base,
    baseSource: avgCost !== null ? (row.avg_cost_manual !== null ? 'manual' : 'estimated') : 'price',
    pnl,
    costPartial: basis.partial,
    transferCount: transfers.length,
    // Every transfer, including ones that could not be priced — the activity
    // log should not silently drop rows. Consumers that need a price (chart
    // markers) filter for themselves.
    trades: basis.trades,
    tranches,
    ladder,
    fills: fills.rungs,
    soldPct: fills.soldPct,
    missed: fills.missed,
    planBalance,
    drift,
    stats,
    suggestion,
    previews,
    poolAddress,
  })
}
