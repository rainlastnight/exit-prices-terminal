import { describe, it, expect } from 'vitest'
import { alertKey, type FiredAlert } from '@/components/AlertToast'

/**
 * Regression: toasts were keyed on trackedId, which collides whenever one
 * position fires several alerts in the same poll — one per tranche rung.
 * React then warns about duplicate keys and may drop or merge toasts.
 */

const alert = (over: Partial<Omit<FiredAlert, 'key'>> = {}): Omit<FiredAlert, 'key'> => ({
  trackedId: 1,
  symbol: 'STONKBROKER',
  chainId: 4663,
  direction: 'up',
  metric: 'price',
  threshold: 0.02,
  value: 0.031,
  ...over,
})

describe('alertKey', () => {
  it('distinguishes two rungs of the same position firing together', () => {
    const rung2x = alertKey(alert({ threshold: 0.02 }))
    const rung5x = alertKey(alert({ threshold: 0.05 }))
    expect(rung2x).not.toBe(rung5x)
  })

  it('distinguishes a target from a stop on the same position', () => {
    expect(alertKey(alert({ direction: 'up' }))).not.toBe(alertKey(alert({ direction: 'down' })))
  })

  it('distinguishes the same threshold across different positions', () => {
    expect(alertKey(alert({ trackedId: 1 }))).not.toBe(alertKey(alert({ trackedId: 2 })))
  })

  it('is stable for the same alert, so dedup suppresses a repeat', () => {
    expect(alertKey(alert({ value: 0.031 }))).toBe(alertKey(alert({ value: 0.045 })))
  })

  it('produces unique keys across a whole ladder firing at once', () => {
    const ladder = [0.02, 0.05, 0.1].map((threshold) => alertKey(alert({ threshold })))
    expect(new Set(ladder).size).toBe(ladder.length)
  })
})
