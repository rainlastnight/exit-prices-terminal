import { describe, it, expect } from 'vitest'
import { parseThreshold, formatUsd, formatPrice, isValidAddress } from '../format'

describe('parseThreshold', () => {
  it('parses plain numbers and currency noise', () => {
    expect(parseThreshold('0.05')).toBe(0.05)
    expect(parseThreshold('$1.20')).toBe(1.2)
    expect(parseThreshold(' 1,500 ')).toBe(1500)
  })

  it('parses trader shorthand for FDV targets', () => {
    expect(parseThreshold('74M')).toBe(74_000_000)
    expect(parseThreshold('100m')).toBe(100_000_000)
    expect(parseThreshold('1.5b')).toBe(1_500_000_000)
    expect(parseThreshold('250k')).toBe(250_000)
  })

  // Rejecting rather than coercing matters: a silent 0 would make a stop-loss
  // that can never fire look like a valid rule.
  it('rejects garbage instead of coercing to zero', () => {
    for (const bad of ['', 'abc', '1.2.3', '$', '-5', '0', 'M']) {
      expect(parseThreshold(bad)).toBeNull()
    }
  })
})

describe('formatUsd', () => {
  it('uses M/B shorthand for large caps', () => {
    expect(formatUsd(74_097_821)).toBe('$74.10M')
    expect(formatUsd(48_262_563)).toBe('$48.26M')
    expect(formatUsd(1_500_000_000)).toBe('$1.50B')
  })

  it('renders null as an em dash', () => {
    expect(formatUsd(null)).toBe('—')
  })
})

describe('formatPrice', () => {
  it('keeps significant digits on sub-tick prices', () => {
    expect(formatPrice(0.000001287823962)).toBe('$0.000001288')
    expect(formatPrice(0.03066807)).toBe('$0.030668')
  })

  it('does not collapse small prices to $0.00', () => {
    expect(formatPrice(0.00000001)).not.toBe('$0.00')
  })

  // Scientific notation on a price row reads as a rendering bug.
  it('never emits scientific notation', () => {
    for (const v of [5e-7, 1.289e-6, 3.2e-12, 1e-15]) {
      expect(formatPrice(v)).not.toMatch(/e[-+]/i)
    }
    expect(formatPrice(5e-7)).toBe('$0.0000005000')
  })
})

describe('isValidAddress', () => {
  it('accepts checksummed and lowercase addresses', () => {
    expect(isValidAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true)
    expect(isValidAddress('0xe934e36a439c94017b64a3fece66af12099abf50')).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(isValidAddress('0x123')).toBe(false)
    expect(isValidAddress('vitalik.eth')).toBe(false)
  })
})
