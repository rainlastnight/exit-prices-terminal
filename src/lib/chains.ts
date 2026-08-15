export type ChainId = 1 | 4663

export interface ChainConfig {
  id: ChainId
  name: string
  short: string
  /** Blockscout instance root — balance + token discovery */
  blockscout: string
  /** DexScreener chain slug, for /tokens/v1/{slug}/{addrs} */
  dexscreener: string
  /** GeckoTerminal network id, for /networks/{net}/... */
  gecko: string
  /** Keyless JSON-RPC, for on-chain reads (totalSupply etc.) */
  rpc: string
  rpcFallback: string
  explorer: string
  nativeSymbol: string
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  1: {
    id: 1,
    name: 'Ethereum',
    short: 'ETH',
    blockscout: 'https://eth.blockscout.com',
    dexscreener: 'ethereum',
    gecko: 'eth',
    rpc: 'https://ethereum-rpc.publicnode.com',
    rpcFallback: 'https://cloudflare-eth.com',
    explorer: 'https://eth.blockscout.com',
    nativeSymbol: 'ETH',
  },
  4663: {
    id: 4663,
    name: 'Robinhood Chain',
    short: 'RH',
    blockscout: 'https://robinhoodchain.blockscout.com',
    dexscreener: 'robinhood',
    gecko: 'robinhood',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    rpcFallback: 'https://robinhood-rpc.publicnode.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    nativeSymbol: 'ETH',
  },
}

export const CHAIN_IDS = Object.keys(CHAINS).map(Number) as ChainId[]

export function getChain(id: number): ChainConfig {
  const c = CHAINS[id as ChainId]
  if (!c) throw new Error(`Unsupported chain: ${id}`)
  return c
}

export function isChainId(id: number): id is ChainId {
  return id in CHAINS
}
