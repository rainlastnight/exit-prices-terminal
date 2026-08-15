import { describe, it, expect } from 'vitest'
import { computeCostBasis, computePnl, priceAt, type Transfer } from '../costbasis'

const DAY = 86_400
const candle = (t: number, close: number) => ({
  time: t,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
})

// $1 on day 0, $2 on day 1, $4 on day 2.
const candles = [candle(0, 1), candle(DAY, 2), candle(2 * DAY, 4)]

const xfer = (ts: number, amount: number): Transfer => ({ ts, amount, txHash: `0x${ts}${amount}` })

describe('priceAt', () => {
  it('takes the closest candle', () => {
    expect(priceAt(candles, DAY + 100)).toBe(2)
    expect(priceAt(candles, 2 * DAY - 100)).toBe(4)
  })

  // Beyond a few days the "closest" candle stops being a meaningful proxy,
  // and a wrong cost basis is worse than an admitted unknown.
  it('refuses to price a transfer far outside the candle range', () => {
    expect(priceAt(candles, 30 * DAY)).toBeNull()
  })

  it('returns null with no candles', () => {
    expect(priceAt([], 0)).toBeNull()
  })
})

describe('computeCostBasis', () => {
  it('averages the cost of multiple buys', () => {
    // 100 @ $1 then 100 @ $2 -> 200 tokens, $300 cost, avg $1.50
    const r = computeCostBasis([xfer(0, 100), xfer(DAY, 100)], candles)
    expect(r.heldTokens).toBe(200)
    expect(r.avgCost).toBeCloseTo(1.5, 10)
    expect(r.costOfHeld).toBeCloseTo(300, 10)
    expect(r.realizedPnl).toBe(0)
  })

  it('realises profit on a sell against the running average', () => {
    // Buy 100@1, buy 100@2 (avg 1.5), sell 100@4 -> realised 100*(4-1.5) = 250
    const r = computeCostBasis([xfer(0, 100), xfer(DAY, 100), xfer(2 * DAY, -100)], candles)
    expect(r.realizedPnl).toBeCloseTo(250, 10)
    expect(r.heldTokens).toBe(100)
    // The remaining 100 tokens keep the $1.50 average.
    expect(r.avgCost).toBeCloseTo(1.5, 10)
  })

  it('processes transfers chronologically regardless of input order', () => {
    const forward = computeCostBasis([xfer(0, 100), xfer(DAY, 100)], candles)
    const reversed = computeCostBasis([xfer(DAY, 100), xfer(0, 100)], candles)
    expect(reversed.avgCost).toBeCloseTo(forward.avgCost!, 10)
  })

  it('flags a partial result when a transfer cannot be priced', () => {
    const r = computeCostBasis([xfer(0, 100), xfer(60 * DAY, 50)], candles)
    expect(r.partial).toBe(true)
    // Quantity is still tracked so the held balance stays correct.
    expect(r.heldTokens).toBe(150)
  })

  it('never lets a sell drive the held balance negative', () => {
    const r = computeCostBasis([xfer(0, 10), xfer(DAY, -999)], candles)
    expect(r.heldTokens).toBe(0)
  })

  it('returns a null average when nothing could be priced', () => {
    const r = computeCostBasis([xfer(90 * DAY, 100)], candles)
    expect(r.avgCost).toBeNull()
    expect(r.partial).toBe(true)
  })

  it('labels each transfer as a buy or a sell', () => {
    const r = computeCostBasis([xfer(0, 100), xfer(DAY, -40)], candles)
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'sell'])
  })
})

describe('computePnl', () => {
  it('computes unrealised profit against cost', () => {
    const p = computePnl(100, 4, 1.5, 250)
    expect(p.costValue).toBeCloseTo(150)
    expect(p.marketValue).toBeCloseTo(400)
    expect(p.unrealized).toBeCloseTo(250)
    expect(p.unrealizedPct).toBeCloseTo(250 / 150, 10)
    expect(p.realized).toBe(250)
  })

  it('handles a loss', () => {
    const p = computePnl(100, 0.5, 1)
    expect(p.unrealized).toBeCloseTo(-50)
    expect(p.unrealizedPct).toBeCloseTo(-0.5)
  })

  it('returns nulls rather than zero when cost basis is unknown', () => {
    const p = computePnl(100, 4, null)
    expect(p.unrealized).toBeNull()
    expect(p.unrealizedPct).toBeNull()
    expect(p.marketValue).toBeCloseTo(400)
  })
})
