import { describe, it, expect } from 'vitest'
import { logPos, railGeometry } from '../rail'

describe('logPos', () => {
  it('anchors the endpoints', () => {
    expect(logPos(1, 1, 100)).toBeCloseTo(0)
    expect(logPos(100, 1, 100)).toBeCloseTo(1)
  })

  it('puts the geometric mean at the midpoint', () => {
    expect(logPos(10, 1, 100)).toBeCloseTo(0.5, 10)
  })

  it('clamps rather than overflowing the rail', () => {
    expect(logPos(1000, 1, 100)).toBe(1)
    expect(logPos(0.01, 1, 100)).toBe(0)
  })

  it('returns 0 for degenerate input instead of NaN', () => {
    expect(logPos(0, 1, 100)).toBe(0)
    expect(logPos(-5, 1, 100)).toBe(0)
    expect(logPos(10, 100, 100)).toBe(0)
  })
})

describe('railGeometry', () => {
  const cost = 0.02
  const rungs = [0.04, 0.1, 0.2] // 2x, 5x, 10x

  it('orders rungs left to right regardless of input order', () => {
    const g = railGeometry(cost, 0.03, [0.2, 0.04, 0.1])!
    expect(g.rungs.map((r) => r.price)).toEqual([0.04, 0.1, 0.2])
    expect(g.rungs.map((r) => r.pos)).toEqual([...g.rungs.map((r) => r.pos)].sort((a, b) => a - b))
  })

  /**
   * The whole reason for a log axis: on a linear scale 2x would sit at
   * (0.04-0.02)/(0.2-0.02) ≈ 11% and the first two rungs would be unreadable.
   */
  it('spaces the ladder so early rungs are not crushed against the left', () => {
    const g = railGeometry(cost, 0.03, rungs)!
    const twoX = g.rungs[0].pos
    expect(twoX).toBeGreaterThan(0.25)

    const linear = (0.04 - 0.02) / (0.2 - 0.02)
    expect(twoX).toBeGreaterThan(linear * 2)
  })

  it('keeps the current price between cost and the next rung', () => {
    const g = railGeometry(cost, 0.03, rungs)!
    expect(g.pricePos!).toBeGreaterThan(g.costPos)
    expect(g.pricePos!).toBeLessThan(g.rungs[0].pos)
  })

  // A losing position must visibly sit behind its cost basis, not pin to zero.
  it('places an underwater price left of cost basis', () => {
    const g = railGeometry(cost, 0.01, rungs)!
    expect(g.pricePos!).toBeLessThan(g.costPos)
    expect(g.pricePos!).toBeGreaterThan(0)
  })

  it('leaves headroom so the top rung is not flush with the edge', () => {
    const g = railGeometry(cost, 0.03, rungs)!
    expect(g.rungs[2].pos).toBeLessThan(1)
    expect(g.rungs[2].pos).toBeGreaterThan(0.9)
  })

  it('handles a missing price without breaking the rail', () => {
    const g = railGeometry(cost, null, rungs)!
    expect(g.pricePos).toBeNull()
    expect(g.rungs).toHaveLength(3)
  })

  it('returns null when there is no journey to draw', () => {
    expect(railGeometry(null, 0.03, rungs)).toBeNull()
    expect(railGeometry(cost, 0.03, [])).toBeNull()
    // Rungs at or below cost basis are not a ladder.
    expect(railGeometry(0.5, 0.03, [0.04, 0.1])).toBeNull()
  })
})
