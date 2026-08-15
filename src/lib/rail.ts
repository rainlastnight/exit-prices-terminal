/**
 * Geometry for the ladder rail.
 *
 * Positions are logarithmic. On a linear axis a 10x rung sets the scale and
 * crushes 2x into the left fifth, which destroys the one reading the rail
 * exists to give — how much further to the next rung. On a log axis the gaps
 * between 2x, 5x and 10x stay comparable.
 *
 * Kept pure and separate from the component so the maths is unit tested.
 */

export interface RailGeometry {
  /** Domain of the axis. */
  lo: number
  hi: number
  costPos: number
  pricePos: number | null
  rungs: Array<{ pos: number; price: number }>
}

/** Fractional position of `v` on a log axis spanning [lo, hi], clamped to [0,1]. */
export function logPos(v: number, lo: number, hi: number): number {
  if (!(v > 0) || !(lo > 0) || !(hi > lo)) return 0
  const t = (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
  return Math.max(0, Math.min(1, t))
}

/**
 * Lay out a rail from cost basis, current price and rung prices.
 * Returns null when there is no journey to draw.
 */
export function railGeometry(
  costBasis: number | null,
  price: number | null,
  rungPrices: number[],
): RailGeometry | null {
  if (!costBasis || costBasis <= 0 || rungPrices.length === 0) return null

  const sorted = [...rungPrices].sort((a, b) => a - b)
  const top = sorted[sorted.length - 1]
  if (!(top > costBasis)) return null

  // A losing position sits left of cost, so the low end has to stretch to
  // contain it or the marker would pin to the edge and read as break-even.
  const lo = Math.min(costBasis, price && price > 0 ? price : costBasis) * 0.96
  const hi = top * 1.06

  return {
    lo,
    hi,
    costPos: logPos(costBasis, lo, hi),
    pricePos: price && price > 0 ? logPos(price, lo, hi) : null,
    rungs: sorted.map((p) => ({ pos: logPos(p, lo, hi), price: p })),
  }
}
