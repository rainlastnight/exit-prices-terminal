import { cachedFetch } from './cache'
import { getChain } from './chains'

/**
 * GeckoTerminal client — the canonical source for price, FDV, market cap,
 * supply and OHLCV candles.
 *
 * This is also the API that resolves the OpenSea-vs-Gecko market cap question:
 * the token endpoint returns `fdv_usd` (what OpenSea displays) *and*
 * `market_cap_usd` (what GeckoTerminal's own UI displays) in one response, so
 * we can show both without an OpenSea API key.
 *
 * Free tier is ~30 req/min, so every call here goes through the shared cache.
 */

const BASE = 'https://api.geckoterminal.com/api/v2'

export type Timeframe = 'minute' | 'hour' | 'day'

interface GtToken {
  data?: {
    attributes?: {
      name?: string
      symbol?: string
      decimals?: number
      total_supply?: string
      price_usd?: string
      fdv_usd?: string
      market_cap_usd?: string | null
      total_reserve_in_usd?: string
    }
  }
}

interface GtPools {
  data?: Array<{
    attributes?: {
      address?: string
      name?: string
      base_token_price_usd?: string
      reserve_in_usd?: string
      volume_usd?: { h24?: string }
    }
    relationships?: {
      base_token?: { data?: { id?: string } }
    }
  }>
}

interface GtOhlcv {
  data?: { attributes?: { ohlcv_list?: number[][] } }
}

export interface TokenStats {
  name: string | null
  symbol: string | null
  decimals: number | null
  /** Human-readable total supply (already divided by 10^decimals). */
  totalSupply: number | null
  priceUsd: number | null
  /** What OpenSea shows. */
  fdvUsd: number | null
  /** What GeckoTerminal shows. Null for most long-tail tokens. */
  marketCapUsd: number | null
}

export interface PoolInfo {
  address: string
  name: string | null
  priceUsd: number | null
  liquidityUsd: number
  volume24h: number | null
}

export interface Candle {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Token-level stats including FDV and market cap.
 *
 * `total_supply` comes back raw (in base units), so it is scaled by decimals
 * here — that scaled value is what FDV must be recomputed from.
 */
export async function getTokenStats(
  chainId: number,
  address: string,
): Promise<TokenStats | null> {
  const chain = getChain(chainId)
  const res = await cachedFetch<GtToken>(
    `${BASE}/networks/${chain.gecko}/tokens/${address.toLowerCase()}`,
    { ttlMs: 60_000 },
  )
  const a = res?.data?.attributes
  if (!a) return null

  const decimals = typeof a.decimals === 'number' ? a.decimals : null
  const rawSupply = num(a.total_supply)
  const totalSupply =
    rawSupply !== null && decimals !== null ? rawSupply / 10 ** decimals : null

  return {
    name: a.name ?? null,
    symbol: a.symbol ?? null,
    decimals,
    totalSupply,
    priceUsd: num(a.price_usd),
    fdvUsd: num(a.fdv_usd),
    marketCapUsd: num(a.market_cap_usd),
  }
}

/** All pools for a token, sorted by liquidity descending. */
export async function getPools(chainId: number, address: string): Promise<PoolInfo[]> {
  const chain = getChain(chainId)
  const res = await cachedFetch<GtPools>(
    `${BASE}/networks/${chain.gecko}/tokens/${address.toLowerCase()}/pools`,
    { ttlMs: 300_000 },
  )

  const pools = (res?.data ?? [])
    .map((p) => {
      const a = p.attributes ?? {}
      if (!a.address) return null
      return {
        address: a.address,
        name: a.name ?? null,
        priceUsd: num(a.base_token_price_usd),
        liquidityUsd: num(a.reserve_in_usd) ?? 0,
        volume24h: num(a.volume_usd?.h24),
      }
    })
    .filter((p): p is PoolInfo => p !== null)

  return pools.sort((x, y) => y.liquidityUsd - x.liquidityUsd)
}

/**
 * The deepest pool for a token — the one whose price we trust.
 * Pool choice matters: the same token can quote 7.5x apart across two pools.
 */
export async function getBestPool(chainId: number, address: string): Promise<PoolInfo | null> {
  const pools = await getPools(chainId, address)
  return pools[0] ?? null
}

const CANDLE_TTL: Record<Timeframe, number> = {
  minute: 60_000,
  hour: 300_000,
  day: 3_600_000,
}

/** OHLCV candles for a pool. Note: thin tokens produce gappy, unevenly spaced bars. */
export async function getCandles(
  chainId: number,
  poolAddress: string,
  timeframe: Timeframe = 'hour',
  limit = 300,
): Promise<Candle[]> {
  const chain = getChain(chainId)
  const res = await cachedFetch<GtOhlcv>(
    `${BASE}/networks/${chain.gecko}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`,
    { ttlMs: CANDLE_TTL[timeframe] },
  )

  const list = res?.data?.attributes?.ohlcv_list ?? []

  return list
    .map(([time, open, high, low, close, volume]) => ({
      time,
      open,
      high,
      low,
      close,
      volume: volume ?? 0,
    }))
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time)
}
