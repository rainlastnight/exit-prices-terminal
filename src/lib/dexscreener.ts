import { cachedFetch } from './cache'
import { getChain } from './chains'

/**
 * DexScreener client — batch spot prices, used as the fallback source and for
 * tokens where we have not resolved a GeckoTerminal pool.
 *
 * Two hard-won rules encoded here:
 *  - Only ever use the chain-scoped /tokens/v1/{slug}/{addrs} form. The older
 *    /latest/dex/tokens/{addr} endpoint is chain-blind and will happily return
 *    a PulseChain pair for a mainnet address.
 *  - Among the returned pairs, pick the one with the highest liquidity. The
 *    same token can quote 7.5x apart across two pools on the same chain.
 */

const BASE = 'https://api.dexscreener.com'
const MAX_BATCH = 30

export interface DexPair {
  chainId: string
  dexId: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; name: string; symbol: string }
  priceUsd?: string
  liquidity?: { usd?: number }
  fdv?: number
  marketCap?: number
  volume?: { h24?: number }
  priceChange?: { h24?: number }
}

export interface DexQuote {
  address: string
  priceUsd: number | null
  liquidityUsd: number | null
  /** DexScreener reports FDV under both `fdv` and `marketCap`; only FDV is meaningful. */
  fdv: number | null
  volume24h: number | null
  priceChange24h: number | null
  pairAddress: string | null
  dexId: string | null
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Pick the pair that best represents this token's price: the token must be the
 * base side, and among those we take the deepest liquidity.
 *
 * Returns null when no pair quotes this token as the base. There is
 * deliberately no fallback to "some other pair in the list": callers batch up
 * to 30 tokens into one request and pass the combined pair list here, so any
 * fallback would hand an unpriced token its neighbour's price. A token with no
 * pair must resolve to null and stay silent.
 */
export function pickBestPair(pairs: DexPair[], tokenAddress: string): DexPair | null {
  const want = tokenAddress.toLowerCase()
  const candidates = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === want)
  if (candidates.length === 0) return null

  return candidates.reduce((best, p) => {
    const a = p.liquidity?.usd ?? 0
    const b = best.liquidity?.usd ?? 0
    return a > b ? p : best
  })
}

/** Batch spot quotes for up to any number of addresses on one chain. */
export async function getQuotes(
  chainId: number,
  addresses: string[],
): Promise<Map<string, DexQuote>> {
  const chain = getChain(chainId)
  const out = new Map<string, DexQuote>()
  if (addresses.length === 0) return out

  const batches = chunk([...new Set(addresses.map((a) => a.toLowerCase()))], MAX_BATCH)

  const results = await Promise.all(
    batches.map((batch) =>
      cachedFetch<DexPair[]>(`${BASE}/tokens/v1/${chain.dexscreener}/${batch.join(',')}`, {
        ttlMs: 30_000,
      }),
    ),
  )

  const allPairs = results.flatMap((r) => r ?? [])

  for (const address of new Set(addresses.map((a) => a.toLowerCase()))) {
    const best = pickBestPair(allPairs, address)
    if (!best) continue
    out.set(address, {
      address,
      priceUsd: num(best.priceUsd),
      liquidityUsd: best.liquidity?.usd ?? null,
      fdv: best.fdv ?? null,
      volume24h: best.volume?.h24 ?? null,
      priceChange24h: best.priceChange?.h24 ?? null,
      pairAddress: best.pairAddress ?? null,
      dexId: best.dexId ?? null,
    })
  }

  return out
}
