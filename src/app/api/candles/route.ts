import { NextResponse } from 'next/server'
import { getBestPool, getCandles, type Timeframe } from '@/lib/geckoterminal'
import { getTracked, recordPrice } from '@/lib/store'
import { isChainId } from '@/lib/chains'

export const dynamic = 'force-dynamic'

const TIMEFRAMES = new Set<Timeframe>(['minute', 'hour', 'day'])

/**
 * OHLCV for a tracked token. The pool is resolved once and cached on the row,
 * so repeated chart views cost one GeckoTerminal call instead of two.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const trackedId = Number(url.searchParams.get('trackedId'))
  const tfParam = (url.searchParams.get('timeframe') ?? 'hour') as Timeframe
  const timeframe = TIMEFRAMES.has(tfParam) ? tfParam : 'hour'

  // GeckoTerminal caps a page at 1000 candles; asking for more just wastes the
  // request, so clamp here rather than letting the caller decide.
  const requested = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(requested) ? Math.max(20, Math.min(1000, requested)) : 300

  if (!Number.isFinite(trackedId)) {
    return NextResponse.json({ error: 'Missing trackedId' }, { status: 400 })
  }

  const row = getTracked(trackedId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isChainId(row.chain_id)) {
    return NextResponse.json({ error: 'Unsupported chain' }, { status: 400 })
  }
  if (row.token_address === 'native') {
    return NextResponse.json({ candles: [], reason: 'native-coin' })
  }

  let poolAddress = row.pool_address
  let poolLiquidity = row.pool_liquidity

  if (!poolAddress) {
    const pool = await getBestPool(row.chain_id, row.token_address).catch(() => null)
    if (!pool) {
      // Genuinely no DEX pool — the row can show a price from elsewhere but has
      // no candle history to draw.
      return NextResponse.json({ candles: [], reason: 'no-pool' })
    }
    poolAddress = pool.address
    poolLiquidity = pool.liquidityUsd
    recordPrice(row.id, row.last_price, row.last_fdv, row.last_mc, {
      poolAddress,
      poolLiquidity,
    })
  }

  const candles = await getCandles(row.chain_id, poolAddress, timeframe, limit).catch(() => [])

  return NextResponse.json({
    candles,
    poolAddress,
    poolLiquidity,
    timeframe,
    limit,
    totalSupply: row.total_supply ? Number(row.total_supply) : null,
  })
}
