import { describe, it, expect } from 'vitest'
import {
  TEMPLATES,
  resolveLadder,
  suggestTemplate,
  analyzeHistory,
  validateCustom,
} from '../templates'

describe('validateCustom', () => {
  const row = (multiple: string, pct: string) => ({ multiple, pct })

  it('accepts a well-formed ladder', () => {
    const v = validateCustom([row('2', '40'), row('3.5', '30')])
    expect(v.ok).toBe(true)
    expect(v.tranches).toEqual([
      { multiple: 2, pct: 40 },
      { multiple: 3.5, pct: 30 },
    ])
    expect(v.totalPct).toBe(70)
  })

  it('sorts rungs by multiple regardless of entry order', () => {
    const v = validateCustom([row('10', '20'), row('2', '50'), row('5', '30')])
    expect(v.tranches.map((t) => t.multiple)).toEqual([2, 5, 10])
  })

  // Selling only part of the position and keeping the rest is a real strategy.
  it('allows allocating less than 100%', () => {
    const v = validateCustom([row('2', '50')])
    expect(v.ok).toBe(true)
    expect(v.totalPct).toBe(50)
  })

  it('rejects selling more than the position', () => {
    const v = validateCustom([row('2', '60'), row('3', '60')])
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/cannot sell more than the position/i)
  })

  // This ladder only fires upwards, so a multiple at or below cost can never
  // trigger — accepting it would create a rung that silently never fires.
  it('rejects multiples at or below 1x', () => {
    expect(validateCustom([row('1', '50')]).ok).toBe(false)
    expect(validateCustom([row('0.8', '50')]).ok).toBe(false)
    expect(validateCustom([row('1', '50')]).errors.join(' ')).toMatch(/above 1x/i)
  })

  it('rejects duplicate rungs', () => {
    const v = validateCustom([row('2', '30'), row('2', '30')])
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/duplicate/i)
  })

  it('rejects non-numeric and non-positive input rather than coercing it', () => {
    for (const bad of [row('abc', '50'), row('2', 'abc'), row('2', '0'), row('2', '-10')]) {
      expect(validateCustom([bad]).ok).toBe(false)
    }
  })

  it('ignores blank rows so an empty spare row is harmless', () => {
    const v = validateCustom([row('2', '50'), row('', '')])
    expect(v.ok).toBe(true)
    expect(v.tranches).toHaveLength(1)
  })

  it('rejects an entirely empty ladder', () => {
    const v = validateCustom([row('', '')])
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/at least one rung/i)
  })
})

describe('templates', () => {
  it('every preset allocates exactly 100% of the position', () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t.tranches.reduce((s, x) => s + x.pct, 0)).toBe(100)
    }
  })

  // Every name reads as a formula so the picker is scannable.
  it('names every template after its ladder', () => {
    expect(Object.values(TEMPLATES).map((t) => t.name)).toEqual([
      '1.5x & 2x',
      '2x & 4x',
      '2x, 5x & 10x',
    ])
  })

  it('orders presets from lowest targets to highest', () => {
    const topMultiple = (id: keyof typeof TEMPLATES) =>
      Math.max(...TEMPLATES[id].tranches.map((t) => t.multiple))
    expect(topMultiple('scalp')).toBeLessThan(topMultiple('x2x4'))
    expect(topMultiple('x2x4')).toBeLessThan(topMultiple('x2x5x10'))
  })


  it('matches the specified ladders', () => {
    expect(TEMPLATES.scalp.tranches).toEqual([
      { multiple: 1.5, pct: 50 },
      { multiple: 2, pct: 50 },
    ])
    expect(TEMPLATES.x2x4.tranches).toEqual([
      { multiple: 2, pct: 50 },
      { multiple: 4, pct: 50 },
    ])
    expect(TEMPLATES.x2x5x10.tranches).toEqual([
      { multiple: 2, pct: 30 },
      { multiple: 5, pct: 40 },
      { multiple: 10, pct: 30 },
    ])
  })
})

describe('resolveLadder', () => {
  // 1000 tokens bought at $1, now $1.20, on the 2x/5x/10x ladder.
  const base = 1
  const balance = 1000
  const ladder = () => resolveLadder(TEMPLATES.x2x5x10.tranches, base, balance, 1.2, 1)

  it('prices each tranche as a multiple of the base', () => {
    expect(ladder().tranches.map((t) => t.price)).toEqual([2, 5, 10])
  })

  it('splits the bag by tranche percentage', () => {
    expect(ladder().tranches.map((t) => t.tokens)).toEqual([300, 400, 300])
  })

  it('totals the proceeds if every tranche fills', () => {
    // 300*2 + 400*5 + 300*10 = 600 + 2000 + 3000
    expect(ladder().totalTargetValue).toBe(5600)
  })

  it('weights the average exit price by allocation, not evenly', () => {
    // (2*30 + 5*40 + 10*30) / 100 = 5.6 — not (2+5+10)/3 = 5.67
    expect(ladder().avgExitPrice).toBeCloseTo(5.6, 10)
  })

  it('reports gain against both current value and cost', () => {
    const l = ladder()
    expect(l.gainVsCurrentPct).toBeCloseTo(5600 / 1200 - 1, 10)
    expect(l.gainVsCostPct).toBeCloseTo(5600 / 1000 - 1, 10)
  })

  it('points at the nearest unfired tranche and its distance', () => {
    const l = ladder()
    expect(l.nextTranche?.multiple).toBe(2)
    expect(l.distanceToNext).toBeCloseTo(2 / 1.2 - 1, 10)
  })

  it('skips tranches that already fired', () => {
    const l = resolveLadder(TEMPLATES.x2x5x10.tranches, base, balance, 1.2, 1, [2])
    expect(l.nextTranche?.multiple).toBe(5)
  })

  it('returns no next tranche once all have fired', () => {
    const l = resolveLadder(TEMPLATES.x2x5x10.tranches, base, balance, 1.2, 1, [2, 5, 10])
    expect(l.nextTranche).toBeNull()
    expect(l.distanceToNext).toBeNull()
  })

  it('survives an unknown price without throwing', () => {
    const l = resolveLadder(TEMPLATES.x2x4.tranches, 1, 100, null, null)
    expect(l.distanceToNext).toBeNull()
    expect(l.gainVsCurrentPct).toBeNull()
    expect(l.totalTargetValue).toBe(300)
  })
})

describe('suggestTemplate', () => {
  it('recommends the long ladder for a young, violent token', () => {
    const s = suggestTemplate({
      volatility: 0.4,
      ageDays: 6,
      drawdownFromHigh: 0.7,
      runFromLow: 2,
      liquidityUsd: 500_000,
    })
    expect(s.recommended).toBe('x2x5x10')
    expect(s.reasons.length).toBeGreaterThan(0)
  })

  it('recommends scalping a calm, mature token', () => {
    const s = suggestTemplate({
      volatility: 0.13,
      ageDays: 400,
      drawdownFromHigh: 0.1,
      runFromLow: 1.2,
      liquidityUsd: 2_000_000,
    })
    expect(s.recommended).toBe('scalp')
  })



  // A ladder you cannot fill is worse than no ladder.
  it('pulls the exit earlier when liquidity is too thin to sell into', () => {
    const stats = {
      volatility: 0.4,
      ageDays: 6,
      drawdownFromHigh: 0.7,
      runFromLow: 2,
      liquidityUsd: 800,
    }
    expect(suggestTemplate(stats).recommended).not.toBe('x2x5x10')
    expect(suggestTemplate(stats).reasons.join(' ')).toMatch(/liquidity/i)
  })

  it('falls back to the balanced default without history', () => {
    const s = suggestTemplate({
      volatility: null,
      ageDays: null,
      drawdownFromHigh: null,
      runFromLow: null,
      liquidityUsd: null,
    })
    expect(s.recommended).toBe('x2x4')
    expect(s.confidence).toBe('low')
  })
})

describe('analyzeHistory', () => {
  it('measures volatility, span and drawdown from candles', () => {
    const day = 86_400
    const candles = [
      { time: 0, close: 1, high: 1, low: 1 },
      { time: day, close: 2, high: 2, low: 1 },
      { time: 2 * day, close: 1.5, high: 2.2, low: 1.4 },
    ]
    const s = analyzeHistory(candles, 100_000)
    expect(s.ageDays).toBeCloseTo(2)
    expect(s.volatility).toBeGreaterThan(0)
    expect(s.drawdownFromHigh).toBeCloseTo(1 - 1.5 / 2.2, 6)
    expect(s.runFromLow).toBeCloseTo(1.5)
  })

  it('reports nulls rather than NaN for a single candle', () => {
    const s = analyzeHistory([{ time: 0, close: 1, high: 1, low: 1 }], null)
    expect(s.volatility).toBeNull()
    expect(s.ageDays).toBeNull()
  })
})
