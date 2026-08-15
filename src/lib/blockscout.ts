import { cachedFetch } from './cache'
import { getChain } from './chains'

/**
 * Blockscout client — wallet token discovery and native balance.
 *
 * This is the only keyless source with real ERC-20 discovery coverage, which
 * makes it a single point of failure; callers should tolerate nulls.
 *
 * Caveats encoded here:
 *  - The mainnet response can be ~3 MB / 8k entries for an active address,
 *    mostly airdrop dust. We normalise and rank, never persist the raw list.
 *  - The `reputation` field is useless for spam filtering: every entry,
 *    including obvious dust, reports "ok". Ranking by value is the real filter.
 *  - `exchange_rate` is populated for only a minority of mainnet tokens and for
 *    no Robinhood Chain tokens at all, so it is an opportunistic hint only.
 */

interface BsTokenBalance {
  value: string
  token: {
    address_hash?: string
    address?: string
    symbol?: string
    name?: string
    decimals?: string
    type?: string
    icon_url?: string
    exchange_rate?: string | null
    holders_count?: string
    volume_24h?: string | null
    circulating_market_cap?: string | null
    total_supply?: string | null
  }
}

interface BsAddress {
  hash?: string
  coin_balance?: string
  exchange_rate?: string
}

interface BsStats {
  coin_price?: string
}

export interface DiscoveredToken {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  iconUrl: string | null
  balanceRaw: string
  balance: number
  /** Opportunistic price from Blockscout; usually null off mainnet. */
  hintPriceUsd: number | null
  /** balance * hintPriceUsd when both are known. Drives picker ranking. */
  hintValueUsd: number | null
  holders: number
  totalSupplyRaw: string | null
  isNative: boolean
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

function toUnits(raw: string, decimals: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n / 10 ** decimals : 0
}

/** Native coin price for the chain (ETH on both of ours). */
export async function getNativePrice(chainId: number): Promise<number | null> {
  const chain = getChain(chainId)
  const res = await cachedFetch<BsStats>(`${chain.blockscout}/api/v2/stats`, { ttlMs: 60_000 })
  return num(res?.coin_price)
}

/** Native balance for an address, as a token-like record. */
export async function getNativeBalance(
  chainId: number,
  address: string,
): Promise<DiscoveredToken | null> {
  const chain = getChain(chainId)
  const res = await cachedFetch<BsAddress>(
    `${chain.blockscout}/api/v2/addresses/${address}`,
    { ttlMs: 60_000 },
  )
  if (!res?.coin_balance) return null

  const balance = toUnits(res.coin_balance, 18)
  const price = num(res.exchange_rate)

  return {
    chainId,
    address: 'native',
    symbol: chain.nativeSymbol,
    name: chain.nativeSymbol,
    decimals: 18,
    iconUrl: null,
    balanceRaw: res.coin_balance,
    balance,
    hintPriceUsd: price,
    hintValueUsd: price !== null ? balance * price : null,
    holders: 0,
    totalSupplyRaw: null,
    isNative: true,
  }
}

/**
 * All ERC-20 balances for an address on one chain, ranked so real holdings
 * surface above dust: by known USD value first, then holder count.
 */
export async function getTokenBalances(
  chainId: number,
  address: string,
): Promise<DiscoveredToken[]> {
  const chain = getChain(chainId)
  const res = await cachedFetch<BsTokenBalance[]>(
    `${chain.blockscout}/api/v2/addresses/${address}/token-balances`,
    { ttlMs: 120_000 },
  )
  if (!Array.isArray(res)) return []

  const tokens = res
    .map((entry): DiscoveredToken | null => {
      const t = entry.token ?? {}
      const addr = t.address_hash ?? t.address
      if (!addr) return null
      // NFTs carry no fungible price; exit prices only make sense for ERC-20.
      if (t.type && t.type !== 'ERC-20') return null

      const decimals = Number(t.decimals ?? 18)
      if (!Number.isFinite(decimals)) return null

      const balance = toUnits(entry.value, decimals)
      if (balance <= 0) return null

      const price = num(t.exchange_rate)

      return {
        chainId,
        address: addr.toLowerCase(),
        symbol: t.symbol ?? '???',
        name: t.name ?? 'Unknown token',
        decimals,
        iconUrl: t.icon_url ?? null,
        balanceRaw: entry.value,
        balance,
        hintPriceUsd: price,
        hintValueUsd: price !== null ? balance * price : null,
        holders: Number(t.holders_count ?? 0) || 0,
        totalSupplyRaw: t.total_supply ?? null,
        isNative: false,
      }
    })
    .filter((t): t is DiscoveredToken => t !== null)

  return tokens.sort((a, b) => {
    const av = a.hintValueUsd ?? -1
    const bv = b.hintValueUsd ?? -1
    if (av !== bv) return bv - av
    return b.holders - a.holders
  })
}

interface BsTransfers {
  items?: Array<{
    timestamp?: string
    transaction_hash?: string
    from?: { hash?: string }
    to?: { hash?: string }
    total?: { value?: string; decimals?: string }
  }>
  next_page_params?: Record<string, unknown> | null
}

/**
 * A wallet's transfer history for one token, signed relative to that wallet
 * (positive = received, negative = sent). This is the raw material for cost
 * basis, so it pages until exhausted rather than taking only the first page.
 */
export async function getTokenTransfers(
  chainId: number,
  address: string,
  token: string,
  maxPages = 5,
): Promise<Array<{ ts: number; amount: number; txHash: string }>> {
  const chain = getChain(chainId)
  const me = address.toLowerCase()
  const out: Array<{ ts: number; amount: number; txHash: string }> = []

  let url = `${chain.blockscout}/api/v2/addresses/${address}/token-transfers?token=${token}`

  for (let page = 0; page < maxPages; page++) {
    const res = await cachedFetch<BsTransfers>(url, { ttlMs: 300_000 })
    if (!res?.items) break

    for (const item of res.items) {
      const raw = item.total?.value
      const decimals = Number(item.total?.decimals ?? 18)
      if (!raw || !Number.isFinite(decimals)) continue

      const magnitude = Number(raw) / 10 ** decimals
      if (!Number.isFinite(magnitude) || magnitude === 0) continue

      const to = item.to?.hash?.toLowerCase()
      const from = item.from?.hash?.toLowerCase()
      // Self-transfers net to zero and would otherwise double-count.
      if (to === me && from === me) continue
      if (to !== me && from !== me) continue

      const ts = item.timestamp ? Math.floor(new Date(item.timestamp).getTime() / 1000) : 0
      if (!ts) continue

      out.push({
        ts,
        amount: to === me ? magnitude : -magnitude,
        txHash: item.transaction_hash ?? '',
      })
    }

    const next = res.next_page_params
    if (!next || Object.keys(next).length === 0) break

    const qs = new URLSearchParams({ token })
    for (const [k, v] of Object.entries(next)) qs.set(k, String(v))
    url = `${chain.blockscout}/api/v2/addresses/${address}/token-transfers?${qs}`
  }

  return out.sort((a, b) => a.ts - b.ts)
}

/** Discover everything held by an address on one chain, native first. */
export async function discoverWallet(
  chainId: number,
  address: string,
): Promise<DiscoveredToken[]> {
  const [native, tokens] = await Promise.all([
    getNativeBalance(chainId, address),
    getTokenBalances(chainId, address),
  ])
  return native ? [native, ...tokens] : tokens
}
