import { describe, it, expect } from 'vitest'
import { reconcileRungs, costBasisDrift, planBaseFrom, type RungInput, type Sell } from '../reconcile'

/** 1000-token position, 2x/5x ladder selling 50% at each. */
const rungs = (over: Partial<RungInput>[] = []): RungInput[] => [
  { multiple: 2, price: 2, pct: 50, reached: false, ...over[0] },
  { multiple: 5, price: 5, pct: 50, reached: false, ...over[1] },
]

const sell = (price: number, tokens: number, ts = 0): Sell => ({ price, tokens, ts })

describe('reconcileRungs', () => {
  it('marks a rung pending before price reaches it', () => {
    const r = reconcileRungs(rungs(), 1000, [])
    expect(r.rungs.map((x) => x.state)).toEqual(['pending', 'pending'])
    expect(r.soldPct).toBe(0)
  })

  /**
   * The case that prompted this: price blew through 2x and nothing was sold.
   * Previously that showed as "filled".
   */
  it('marks a reached rung with no sale as missed, not sold', () => {
    const r = reconcileRungs(rungs([{ reached: true }]), 1000, [])
    expect(r.rungs[0].state).toBe('missed')
    expect(r.missed).toHaveLength(1)
    expect(r.soldPct).toBe(0)
  })

  it('marks a rung sold when the tranche was actually sold at that level', () => {
    const r = reconcileRungs(rungs([{ reached: true }]), 1000, [sell(2.1, 500)])
    expect(r.rungs[0].state).toBe('sold')
    expect(r.soldPct).toBeCloseTo(0.5)
  })

  it('marks a partly-sold tranche as partial', () => {
    const r = reconcileRungs(rungs([{ reached: true }]), 1000, [sell(2.1, 200)])
    expect(r.rungs[0].state).toBe('partial')
    expect(r.soldPct).toBeCloseTo(0.2)
  })

  /**
   * Highest-first matching: one big sale at 5x must not be credited to every
   * rung at once, or a single sale would mark the whole ladder complete.
   */
  it('credits a high sale to the high rung first', () => {
    const r = reconcileRungs(rungs([{ reached: true }, { reached: true }]), 1000, [sell(5.2, 500)])
    const [twoX, fiveX] = r.rungs
    expect(fiveX.state).toBe('sold')
    expect(twoX.state).toBe('missed')
    expect(r.soldPct).toBeCloseTo(0.5)
  })

  it('does not credit a sale below the rung price', () => {
    const r = reconcileRungs(rungs([{ reached: true }]), 1000, [sell(1.2, 500)])
    expect(r.rungs[0].state).toBe('missed')
  })

  it('allows a small tolerance so a near-miss fill still counts', () => {
    // 1% under the rung — a realistic fill, not a different decision.
    const r = reconcileRungs(rungs([{ reached: true }]), 1000, [sell(1.98, 500)])
    expect(r.rungs[0].state).toBe('sold')
  })

  it('completes the whole ladder when both tranches sold', () => {
    const r = reconcileRungs(rungs([{ reached: true }, { reached: true }]), 1000, [
      sell(2.1, 500),
      sell(5.5, 500),
    ])
    expect(r.rungs.map((x) => x.state)).toEqual(['sold', 'sold'])
    expect(r.soldPct).toBeCloseTo(1)
    expect(r.missed).toHaveLength(0)
  })

  /**
   * Targets are sized from the balance when the plan was set. Using the live
   * balance would shrink every target as the plan executed, so a half-sold
   * ladder would keep looking complete.
   */
  it('sizes tranches from the plan-time balance, not the current one', () => {
    const r = reconcileRungs(rungs([{ reached: true }]), 1000, [sell(2.1, 500)])
    expect(r.rungs[0].targetTokens).toBe(500)
    expect(r.rungs[1].targetTokens).toBe(500)
  })

  it('weights progress by tranche size, not rung count', () => {
    const uneven: RungInput[] = [
      { multiple: 2, price: 2, pct: 80, reached: true },
      { multiple: 5, price: 5, pct: 20, reached: false },
    ]
    const r = reconcileRungs(uneven, 1000, [sell(2.1, 800)])
    expect(r.soldPct).toBeCloseTo(0.8)
  })

  it('survives an unknown plan balance without dividing by zero', () => {
    const r = reconcileRungs(rungs([{ reached: true }]), 0, [sell(2.1, 500)])
    expect(r.soldPct).toBe(0)
    expect(r.rungs[0].state).toBe('missed')
  })

  it('returns rungs in ascending price order', () => {
    const r = reconcileRungs(rungs(), 1000, [])
    expect(r.rungs.map((x) => x.price)).toEqual([2, 5])
  })
})

describe('costBasisDrift', () => {
  it('reports how far cost basis moved from the plan base', () => {
    const d = costBasisDrift(0.01, 0.015)!
    expect(d.drift).toBeCloseTo(0.5)
  })

  it('reports a negative drift when cost fell', () => {
    expect(costBasisDrift(0.02, 0.01)!.drift).toBeCloseTo(-0.5)
  })

  it('returns null when either side is unknown', () => {
    expect(costBasisDrift(null, 0.01)).toBeNull()
    expect(costBasisDrift(0.01, null)).toBeNull()
    expect(costBasisDrift(0, 0.01)).toBeNull()
  })
})

describe('planBaseFrom', () => {
  it('recovers the base a ladder was built on', () => {
    expect(planBaseFrom([{ price: 0.04, multiple: 2 }, { price: 0.1, multiple: 5 }])).toBeCloseTo(0.02)
  })

  it('returns null for an empty ladder', () => {
    expect(planBaseFrom([])).toBeNull()
  })
})
