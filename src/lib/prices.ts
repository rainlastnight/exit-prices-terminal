import { getQuotes } from './dexscreener'
import { getTokenStats } from './geckoterminal'

/**
 * Resolves the canonical price, FDV and market cap for a set of tokens.
 *
 * Source split, and why:
 *
 *   price + liquidity + FDV inputs -> DexScreener  (batched 30/call, 300/min)
 *   supply + circulating supply    -> GeckoTerminal (1/token, but ~25/min cap)
 *
 * The plan called for GeckoTerminal as the canonical price source, but its free
 * tier is ~25 usable req/min, which a 30s poll over N tokens exhausts almost
 * immediately. DexScreener batches 30 addresses per call and has a 300/min
 * budget, so it is the sustainable choice for the value that updates fastest.
 * The important guarantee — one consistent source, no flapping between two
 * providers quoting ~1% apart — is preserved by *always* pricing from
 * DexScreener and using GeckoTerminal only for slow-moving supply figures
 * (cached 5 minutes).
 *
 * FDV and market cap are then recomputed locally from that single price, so
 * every number on a row is internally consistent:
 *
 *   FDV = totalSupply       x price
 *   MC  = circulatingSupply x price
 *
 * where circulatingSupply is implied from GeckoTerminal's own mc/price ratio.
 * Market cap stays null when GeckoTerminal has no circulating-supply data,
 * which is the norm for long-tail Robinhood Chain tokens — we never silently
 * fall back to FDV under a market-cap label.
 */

/** How long persisted supply figures stay usable before we re-ask GeckoTerminal.
 *  Supply moves slowly, so a long window keeps us well inside the ~25/min cap. */
const SUPPLY_TTL_MS = 300_000

export interface PriceInput {
  chainId: number
  address: string
  /** Cached supply from a previous resolve, to avoid re-hitting GeckoTerminal. */
  totalSupply?: number | null
  /** Cached circulating supply — needed for market cap, which only GeckoTerminal knows. */
  circulatingSupply?: number | null
  /** When the cached supply figures were last refreshed. */
  supplyAt?: number | null
}

export interface PriceResult {
  chainId: number
  address: string
  priceUsd: number | null
  fdvUsd: number | null
  marketCapUsd: number | null
  totalSupply: number | null
  circulatingSupply: number | null
  liquidityUsd: number | null
  volume24h: number | null
  priceChange24h: number | null
  /** Which provider the price came from, for display/debugging. */
  source: 'dexscreener' | 'geckoterminal' | null
}

const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`

export async function resolvePrices(inputs: PriceInput[]): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>()
  if (inputs.length === 0) return out

  // 1. Batch spot data per chain from DexScreener.
  const byChain = new Map<number, string[]>()
  for (const i of inputs) {
    const list = byChain.get(i.chainId) ?? []
    list.push(i.address)
    byChain.set(i.chainId, list)
  }

  const quoteEntries = await Promise.all(
    [...byChain.entries()].map(async ([chainId, addrs]) => {
      const quotes = await getQuotes(chainId, addrs).catch(() => new Map())
      return [chainId, quotes] as const
    }),
  )
  const quotesByChain = new Map(quoteEntries)

  // 2. Supply figures from GeckoTerminal, only where ours are missing or stale.
  //    Both total *and* circulating must be considered: skipping the call just
  //    because total supply is cached would silently drop market cap forever.
  const now = Date.now()
  const statsNeeded = inputs.filter(
    (i) => i.totalSupply == null || (i.supplyAt ?? 0) < now - SUPPLY_TTL_MS,
  )
  const statsEntries = await Promise.all(
    statsNeeded.map(async (i) => {
      const stats = await getTokenStats(i.chainId, i.address).catch(() => null)
      return [key(i.chainId, i.address), stats] as const
    }),
  )
  const statsMap = new Map(statsEntries)

  for (const input of inputs) {
    const k = key(input.chainId, input.address)
    const quote = quotesByChain.get(input.chainId)?.get(input.address.toLowerCase()) ?? null
    const stats = statsMap.get(k) ?? null

    // Canonical price: DexScreener, falling back to GeckoTerminal only when
    // DexScreener has no pair at all for this token.
    let priceUsd: number | null = quote?.priceUsd ?? null
    let source: PriceResult['source'] = priceUsd !== null ? 'dexscreener' : null
    if (priceUsd === null && stats?.priceUsd != null) {
      priceUsd = stats.priceUsd
      source = 'geckoterminal'
    }

    const totalSupply = stats?.totalSupply ?? input.totalSupply ?? null

    // Circulating supply implied by GeckoTerminal's own MC/price pair, falling
    // back to the persisted figure between refreshes. Null when GeckoTerminal
    // has no circulating data — the common case off mainnet — and we never
    // substitute total supply here, or market cap would silently become FDV.
    const freshCirculating =
      stats?.marketCapUsd != null && stats.priceUsd != null && stats.priceUsd > 0
        ? stats.marketCapUsd / stats.priceUsd
        : null
    const circulating = freshCirculating ?? input.circulatingSupply ?? null

    const fdvUsd =
      priceUsd !== null && totalSupply !== null
        ? totalSupply * priceUsd
        : (quote?.fdv ?? stats?.fdvUsd ?? null)

    const marketCapUsd = priceUsd !== null && circulating !== null ? circulating * priceUsd : null

    out.set(k, {
      chainId: input.chainId,
      address: input.address.toLowerCase(),
      priceUsd,
      fdvUsd,
      marketCapUsd,
      totalSupply,
      circulatingSupply: circulating,
      liquidityUsd: quote?.liquidityUsd ?? null,
      volume24h: quote?.volume24h ?? null,
      priceChange24h: quote?.priceChange24h ?? null,
      source,
    })
  }

  return out
}

export { key as priceKey }
