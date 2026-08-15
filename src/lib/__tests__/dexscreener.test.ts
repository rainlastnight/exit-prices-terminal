import { describe, it, expect } from 'vitest'
import { pickBestPair, type DexPair } from '../dexscreener'

/**
 * Pool selection is the highest-value assertion in this suite: picking the
 * wrong pool silently produces a price that is wrong by multiples, which would
 * fire exit alerts at the wrong moment.
 *
 * The fixtures below are real values observed on Robinhood Chain.
 */

const pair = (over: Partial<DexPair> & { base: string; liq: number; price: string }): DexPair => ({
  chainId: 'robinhood',
  dexId: 'uniswap',
  pairAddress: over.pairAddress ?? '0xpool',
  baseToken: { address: over.base, name: 'Token', symbol: 'TKN' },
  quoteToken: { address: '0xweth', name: 'Wrapped Ether', symbol: 'WETH' },
  priceUsd: over.price,
  liquidity: { usd: over.liq },
  ...over,
})

const HOODWORKS = '0x3E7a9A02bD7eF3844Fc0fF899940184E54d5DaAF'

describe('pickBestPair', () => {
  // $HOODWORKS quotes 7.5x apart across its two live pools.
  it('picks the deepest pool, not the highest price', () => {
    const pairs = [
      pair({ base: HOODWORKS, liq: 3.0565, price: '0.000009732562906', pairAddress: '0xshallow' }),
      pair({ base: HOODWORKS, liq: 10.335, price: '0.000001287823962', pairAddress: '0xdeep' }),
    ]

    const best = pickBestPair(pairs, HOODWORKS)
    expect(best?.pairAddress).toBe('0xdeep')
    expect(Number(best?.priceUsd)).toBeCloseTo(0.000001287823962, 12)
  })

  it('is case-insensitive about the token address', () => {
    const pairs = [pair({ base: HOODWORKS.toLowerCase(), liq: 10, price: '1' })]
    expect(pickBestPair(pairs, HOODWORKS.toUpperCase())).not.toBeNull()
  })

  // Guards the chain-blind endpoint trap: a token appearing only as the quote
  // side must not be mistaken for the base side's price.
  it('prefers pairs where the token is the base side', () => {
    const other = '0xother0000000000000000000000000000000000'
    const pairs: DexPair[] = [
      { ...pair({ base: other, liq: 999_999, price: '5000' }) },
      { ...pair({ base: HOODWORKS, liq: 1, price: '0.42' }) },
    ]
    const best = pickBestPair(pairs, HOODWORKS)
    expect(best?.priceUsd).toBe('0.42')
  })

  /**
   * Regression: callers batch up to 30 tokens into one request and pass the
   * combined pair list here. A token with no pair of its own must resolve to
   * null — never inherit a neighbour's price.
   *
   * Observed live: $TELE (no pair) was reported at $0.03103, which was
   * STONKBROKER's price from the same batch.
   */
  it('returns null rather than borrowing another token from the same batch', () => {
    const TELE = '0x6b43234377543FddFBa600d5186f7fCA68B85BC1'
    const STONK = '0xe934e36a439c94017b64a3fece66af12099abf50'
    const batch = [
      pair({ base: STONK, liq: 4_068_768, price: '0.03103' }),
      pair({ base: HOODWORKS, liq: 10.23, price: '0.000001289' }),
    ]
    expect(pickBestPair(batch, TELE)).toBeNull()
  })

  it('treats missing liquidity as zero rather than throwing', () => {
    const pairs: DexPair[] = [
      { ...pair({ base: HOODWORKS, liq: 0, price: '1' }), liquidity: undefined },
      pair({ base: HOODWORKS, liq: 5, price: '2' }),
    ]
    expect(pickBestPair(pairs, HOODWORKS)?.priceUsd).toBe('2')
  })

  it('returns null for an empty pair list', () => {
    expect(pickBestPair([], HOODWORKS)).toBeNull()
  })
})
