import { describe, it, expect } from 'vitest'
import {
  evaluateRule,
  shouldRearm,
  fdvThresholdAsPrice,
  distanceToThreshold,
  type Rule,
} from '../rules'

const rule = (over: Partial<Rule> = {}): Rule => ({
  metric: 'price',
  targetUp: null,
  stopDown: null,
  firedUp: false,
  firedDown: false,
  ...over,
})

describe('evaluateRule', () => {
  it('fires when price crosses the up target', () => {
    const t = evaluateRule(rule({ targetUp: 10 }), { price: 12, fdv: null })
    expect(t).toMatchObject({ direction: 'up', threshold: 10, value: 12 })
  })

  it('fires when price crosses the down stop', () => {
    const t = evaluateRule(rule({ stopDown: 10 }), { price: 8, fdv: null })
    expect(t).toMatchObject({ direction: 'down', threshold: 10, value: 8 })
  })

  it('fires exactly at the threshold', () => {
    expect(evaluateRule(rule({ targetUp: 10 }), { price: 10, fdv: null })).not.toBeNull()
  })

  it('does not fire before the threshold', () => {
    expect(evaluateRule(rule({ targetUp: 10 }), { price: 9.99, fdv: null })).toBeNull()
  })

  // The latch is what stops an alert repeating on every 30s poll.
  it('does not re-fire once latched', () => {
    expect(evaluateRule(rule({ targetUp: 10, firedUp: true }), { price: 99, fdv: null })).toBeNull()
  })

  it('still fires the down leg when only the up leg is latched', () => {
    const r = rule({ targetUp: 10, stopDown: 5, firedUp: true })
    expect(evaluateRule(r, { price: 4, fdv: null })).toMatchObject({ direction: 'down' })
  })

  // A token with no price feed must stay silent, never alert on a phantom 0.
  it('never fires on a null price', () => {
    expect(evaluateRule(rule({ targetUp: 10, stopDown: 1e9 }), { price: null, fdv: null })).toBeNull()
  })

  it('never fires on NaN', () => {
    expect(evaluateRule(rule({ stopDown: 10 }), { price: NaN, fdv: null })).toBeNull()
  })

  it('reads FDV when the metric is fdv, ignoring price', () => {
    const r = rule({ metric: 'fdv', targetUp: 100_000_000 })
    expect(evaluateRule(r, { price: 0.03, fdv: 74_000_000 })).toBeNull()
    expect(evaluateRule(r, { price: 0.03, fdv: 101_000_000 })).toMatchObject({
      direction: 'up',
      metric: 'fdv',
    })
  })

  it('does not fire an fdv rule when fdv is unavailable', () => {
    const r = rule({ metric: 'fdv', targetUp: 1 })
    expect(evaluateRule(r, { price: 999, fdv: null })).toBeNull()
  })
})

describe('shouldRearm', () => {
  const base = { metric: 'price' as const, targetUp: 10, stopDown: 5 }

  it('re-arms the up leg when its target changes', () => {
    expect(shouldRearm(base, { ...base, targetUp: 12 })).toEqual({ up: true, down: false })
  })

  it('re-arms the down leg when its stop changes', () => {
    expect(shouldRearm(base, { ...base, stopDown: 4 })).toEqual({ up: false, down: true })
  })

  it('re-arms both when the metric changes', () => {
    expect(shouldRearm(base, { ...base, metric: 'fdv' })).toEqual({ up: true, down: true })
  })

  it('re-arms nothing when unchanged', () => {
    expect(shouldRearm(base, { ...base })).toEqual({ up: false, down: false })
  })
})

describe('fdvThresholdAsPrice', () => {
  // $STONKBROKER: a $100M FDV target on 2,416,122,424 tokens.
  it('converts an FDV target to its price equivalent', () => {
    expect(fdvThresholdAsPrice(100_000_000, 2_416_122_424)).toBeCloseTo(0.04139, 5)
  })

  it('returns null without a supply figure', () => {
    expect(fdvThresholdAsPrice(100, null)).toBeNull()
    expect(fdvThresholdAsPrice(100, 0)).toBeNull()
  })
})

describe('distanceToThreshold', () => {
  it('is positive when the target is above', () => {
    expect(distanceToThreshold(100, 150)).toBeCloseTo(0.5)
  })

  it('is negative when the stop is below', () => {
    expect(distanceToThreshold(100, 80)).toBeCloseTo(-0.2)
  })

  it('is null without a value', () => {
    expect(distanceToThreshold(null, 100)).toBeNull()
  })
})
