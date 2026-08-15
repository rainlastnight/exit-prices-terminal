import { NextResponse } from 'next/server'
import { resolvePrices, priceKey, type PriceResult } from '@/lib/prices'
import { getNativePrice, getTokenBalances, getNativeBalance } from '@/lib/blockscout'
import { pruneCache } from '@/lib/cache'
import {
  listWallets,
  updateBalance,
  latchFired,
  latchTranche,
  listAllTranches,
  listTracked,
  recordAlert,
  recordPrice,
  type TrackedRow,
  type TrancheRow,
} from '@/lib/store'
import { evaluateRule, type Trigger } from '@/lib/rules'
import type { PricedRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Re-read on-chain balances for every tracked token.
 *
 * Grouped by wallet+chain so one explorer call covers all of that wallet's
 * tokens on that chain, and routed through the shared cache so a 30s poll does
 * not turn into 30s of explorer traffic.
 */
async function refreshBalances(tracked: TrackedRow[]): Promise<void> {
  const wallets = new Map(listWallets().map((w) => [w.id, w.address]))

  const groups = new Map<string, { address: string; chainId: number; rows: TrackedRow[] }>()
  for (const t of tracked) {
    const address = wallets.get(t.wallet_id)
    if (!address) continue
    const key = `${address}:${t.chain_id}`
    const g = groups.get(key) ?? { address, chainId: t.chain_id, rows: [] }
    g.rows.push(t)
    groups.set(key, g)
  }

  await Promise.all(
    [...groups.values()].map(async (g) => {
      try {
        const [tokens, native] = await Promise.all([
          getTokenBalances(g.chainId, g.address),
          getNativeBalance(g.chainId, g.address),
        ])
        const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t.balanceRaw]))
        if (native) byAddress.set('native', native.balanceRaw)

        for (const row of g.rows) {
          const fresh = byAddress.get(row.token_address.toLowerCase())
          // A token fully sold disappears from the balance list; zero it rather
          // than leaving the last known size in place.
          const next = fresh ?? '0'
          if (next !== row.balance_raw) {
            updateBalance(row.id, next)
            row.balance_raw = next
          }
        }
      } catch (err) {
        // Stale balances beat a broken poll.
        console.error(`[prices] balance refresh failed for ${g.address}:`, (err as Error).message)
      }
    }),
  )
}

/**
 * Poll endpoint: refresh every tracked row, evaluate its exit rule, and latch +
 * record any alert that fires. Called by the client on an interval.
 */
export async function GET() {
  const tracked = listTracked()
  if (tracked.length === 0) return NextResponse.json({ rows: [], alerts: [] })

  const fungible = tracked.filter((t) => t.token_address !== 'native')
  const native = tracked.filter((t) => t.token_address === 'native')

  // Native coins aren't DEX-listed under an address; price them from the chain
  // explorer's own feed instead.
  const nativeChains = [...new Set(native.map((t) => t.chain_id))]
  const [priceMap, nativePrices] = await Promise.all([
    resolvePrices(
      fungible.map((t) => ({
        chainId: t.chain_id,
        address: t.token_address,
        totalSupply: t.total_supply ? Number(t.total_supply) : null,
        circulatingSupply: t.circulating_supply,
        supplyAt: t.supply_at,
      })),
    ).catch((err) => {
      console.error('[prices] resolve failed:', (err as Error).message)
      return new Map<string, PriceResult>()
    }),
    Promise.all(
      nativeChains.map(async (c) => [c, await getNativePrice(c).catch(() => null)] as const),
    ),
  ])
  const nativePriceByChain = new Map(nativePrices)

  /* Balances only used to be written when a token was first tracked, so buying
     or selling more left the position size stale forever — and with it value,
     PNL and every tranche figure. Re-read them here; the shared cache keeps
     this to roughly one call per wallet-chain every couple of minutes. */
  await refreshBalances(tracked)

  const allTranches = listAllTranches()
  const tranchesByTracked = new Map<number, TrancheRow[]>()
  for (const t of allTranches) {
    const list = tranchesByTracked.get(t.tracked_id) ?? []
    list.push(t)
    tranchesByTracked.set(t.tracked_id, list)
  }

  const rows: PricedRow[] = []
  const fired: Array<{ row: TrackedRow; trigger: Trigger }> = []

  for (const t of tracked) {
    const isNative = t.token_address === 'native'
    const resolved = isNative ? null : priceMap.get(priceKey(t.chain_id, t.token_address))

    const price = isNative
      ? (nativePriceByChain.get(t.chain_id) ?? null)
      : (resolved?.priceUsd ?? null)

    const fdv = isNative ? null : (resolved?.fdvUsd ?? null)
    const mc = isNative ? null : (resolved?.marketCapUsd ?? null)

    // Persist before evaluating, so a crash mid-loop still leaves fresh prices.
    recordPrice(t.id, price, fdv, mc, {
      totalSupply: resolved?.totalSupply,
      circulatingSupply: resolved?.circulatingSupply,
    })

    const trigger = evaluateRule(
      {
        metric: t.rule_metric,
        targetUp: t.target_up,
        stopDown: t.stop_down,
        firedUp: t.fired_up === 1,
        firedDown: t.fired_down === 1,
      },
      { price, fdv },
    )

    if (trigger) {
      latchFired(t.id, trigger.direction)
      recordAlert(t.id, trigger.direction, trigger.metric, trigger.threshold, trigger.value)
      fired.push({ row: t, trigger })
    }

    /* Tranche ladders latch independently of the single-threshold rule: each
       rung fires once when price reaches it, and never on a null price. */
    const rowTranches = tranchesByTracked.get(t.id) ?? []
    for (const tr of rowTranches) {
      if (tr.fired === 1 || price === null) continue
      if (price < tr.price) continue

      latchTranche(tr.id)
      tr.fired = 1
      recordAlert(t.id, 'up', `tranche:${tr.multiple}x`, tr.price, price)
      fired.push({
        row: t,
        trigger: {
          direction: 'up',
          metric: 'price',
          threshold: tr.price,
          value: price,
        },
      })
    }

    const balance = t.balance_raw ? Number(t.balance_raw) / 10 ** t.decimals : 0

    rows.push({
      ...t,
      last_price: price,
      last_fdv: fdv,
      last_mc: mc,
      price,
      fdv,
      mc,
      liquidity: resolved?.liquidityUsd ?? null,
      change24h: resolved?.priceChange24h ?? null,
      balance,
      valueUsd: price !== null ? balance * price : null,
      source: isNative ? 'blockscout' : (resolved?.source ?? null),
      tranches: rowTranches,
      avgCost: t.avg_cost_manual ?? t.avg_cost ?? null,
      triggered: trigger,
      fired_up: trigger?.direction === 'up' ? 1 : t.fired_up,
      fired_down: trigger?.direction === 'down' ? 1 : t.fired_down,
    })
  }

  pruneCache()

  // Both chains use ETH for gas, so one quote denominates the whole dashboard.
  // Falls back to mainnet when no native position is tracked.
  const ethPrice =
    nativePriceByChain.get(1) ??
    nativePriceByChain.get(4663) ??
    (await getNativePrice(1).catch(() => null))

  return NextResponse.json({
    rows,
    ethPrice,
    alerts: fired.map(({ row, trigger }) => ({
      trackedId: row.id,
      symbol: row.symbol,
      chainId: row.chain_id,
      ...trigger,
    })),
    at: Date.now(),
  })
}
