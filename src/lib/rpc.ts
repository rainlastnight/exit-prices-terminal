import { getChain } from './chains'

/** Minimal keyless JSON-RPC reads. Used as the last-resort supply source. */

const TOTAL_SUPPLY = '0x18160ddd'
const DECIMALS = '0x313ce567'

async function ethCall(chainId: number, to: string, data: string): Promise<string | null> {
  const chain = getChain(chainId)

  for (const url of [chain.rpc, chain.rpcFallback]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const json = (await res.json()) as { result?: string; error?: unknown }
      if (json.error || !json.result || json.result === '0x') continue
      return json.result
    } catch {
      continue
    }
  }
  return null
}

/**
 * Human-readable total supply straight from the contract.
 * Verified to match GeckoTerminal exactly for $STONKBROKER on Robinhood Chain.
 */
export async function getTotalSupply(chainId: number, token: string): Promise<number | null> {
  const [supplyHex, decimalsHex] = await Promise.all([
    ethCall(chainId, token, TOTAL_SUPPLY),
    ethCall(chainId, token, DECIMALS),
  ])
  if (!supplyHex) return null

  const decimals = decimalsHex ? Number(BigInt(decimalsHex)) : 18
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) return null

  try {
    // Go through BigInt so 27-digit supplies don't lose precision before scaling.
    return Number(BigInt(supplyHex)) / 10 ** decimals
  } catch {
    return null
  }
}
