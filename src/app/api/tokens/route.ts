import { NextResponse } from 'next/server'
import { discoverWallet } from '@/lib/blockscout'
import { CHAIN_IDS, isChainId } from '@/lib/chains'
import { isValidAddress } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Discover everything an address holds across both chains.
 *
 * The mainnet payload can be ~3 MB / 8k entries for an active wallet, so the
 * parse and ranking happen here on the server and only a trimmed list crosses
 * the wire. The raw response is never persisted.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const address = url.searchParams.get('address')?.trim() ?? ''
  const chainParam = url.searchParams.get('chainId')

  if (!isValidAddress(address)) {
    return NextResponse.json({ error: 'Enter a valid 0x… address' }, { status: 400 })
  }

  const chains =
    chainParam && isChainId(Number(chainParam)) ? [Number(chainParam)] : CHAIN_IDS

  const results = await Promise.all(
    chains.map(async (chainId) => {
      try {
        return await discoverWallet(chainId, address)
      } catch (err) {
        console.error(`[tokens] chain ${chainId} failed:`, (err as Error).message)
        return []
      }
    }),
  )

  const tokens = results.flat()

  return NextResponse.json({
    address,
    tokens,
    // Surfaced so the UI can warn when a chain returned nothing at all, which
    // usually means Blockscout is down rather than an empty wallet.
    byChain: Object.fromEntries(chains.map((c, i) => [c, results[i].length])),
  })
}
