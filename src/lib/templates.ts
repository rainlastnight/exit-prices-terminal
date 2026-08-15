/**
 * Exit templates and the strategy suggestion heuristic.
 *
 * Pure and dependency-free so the ladder maths and the recommendation can be
 * unit tested without touching the network.
 */

export type TemplateId = 'scalp' | 'x2x4' | 'x2x5x10'

export interface TrancheSpec {
  /** Multiple of the base price this tranche exits at. */
  multiple: number
  /** Percentage of the position to sell at that multiple. */
  pct: number
}

export interface ExitTemplate {
  id: TemplateId
  name: string
  blurb: string
  tranches: TrancheSpec[]
}

/**
 * Three presets, plus a custom ladder the user builds themselves (which goes
 * through the same tranche path — see `validateCustom` below).
 */
export const TEMPLATES: Record<TemplateId, ExitTemplate> = {
  // Named after its ladder, like the others — the id stays `scalp` so existing
  // rows keep resolving.
  scalp: {
    id: 'scalp',
    name: '1.5x & 2x',
    blurb: 'Half at 1.5x, half at 2x. Banks profit early.',
    tranches: [
      { multiple: 1.5, pct: 50 },
      { multiple: 2, pct: 50 },
    ],
  },
  x2x4: {
    id: 'x2x4',
    name: '2x & 4x',
    blurb: 'Half at 2x, half at 4x. Balanced.',
    tranches: [
      { multiple: 2, pct: 50 },
      { multiple: 4, pct: 50 },
    ],
  },
  x2x5x10: {
    id: 'x2x5x10',
    name: '2x, 5x & 10x',
    blurb: 'Scales out slowly. Keeps a runner for the tail.',
    tranches: [
      { multiple: 2, pct: 30 },
      { multiple: 5, pct: 40 },
      { multiple: 10, pct: 30 },
    ],
  },
}

export const TEMPLATE_LIST = Object.values(TEMPLATES)

/* --------------------------------------------------------- custom ladders */

export interface CustomRow {
  /** Raw text, so a half-typed value doesn't get coerced to a number. */
  multiple: string
  pct: string
}

export interface CustomValidation {
  ok: boolean
  tranches: TrancheSpec[]
  totalPct: number
  errors: string[]
}

/**
 * Turn user-entered rows into a ladder, or explain why they can't be.
 *
 * Deliberately permissive about allocating less than 100% — selling only part
 * of a position and keeping the rest is a legitimate plan — but strict about
 * anything that would produce a ladder that cannot fire or double-sells the
 * bag.
 */
export function validateCustom(rows: CustomRow[]): CustomValidation {
  const errors: string[] = []
  const tranches: TrancheSpec[] = []

  const filled = rows.filter((r) => r.multiple.trim() !== '' || r.pct.trim() !== '')
  if (filled.length === 0) errors.push('Add at least one rung.')

  for (const [i, r] of filled.entries()) {
    const multiple = Number(r.multiple)
    const pct = Number(r.pct)
    const at = `Rung ${i + 1}`

    if (!Number.isFinite(multiple) || multiple <= 0) {
      errors.push(`${at}: multiple must be a positive number.`)
      continue
    }
    // A multiple at or below 1 is at or under your cost — that is a stop, not
    // an exit target, and this ladder only fires upwards.
    if (multiple <= 1) {
      errors.push(`${at}: multiple must be above 1x — below that is a loss, not an exit.`)
      continue
    }
    if (!Number.isFinite(pct) || pct <= 0) {
      errors.push(`${at}: sell % must be a positive number.`)
      continue
    }
    if (pct > 100) {
      errors.push(`${at}: cannot sell more than 100%.`)
      continue
    }
    tranches.push({ multiple, pct })
  }

  const totalPct = tranches.reduce((s, t) => s + t.pct, 0)
  if (totalPct > 100) errors.push(`Total is ${totalPct}% — cannot sell more than the position.`)

  const seen = new Set<number>()
  for (const t of tranches) {
    if (seen.has(t.multiple)) errors.push(`Duplicate rung at ${t.multiple}x.`)
    seen.add(t.multiple)
  }

  return {
    ok: errors.length === 0 && tranches.length > 0,
    tranches: [...tranches].sort((a, b) => a.multiple - b.multiple),
    totalPct,
    errors,
  }
}

/* ------------------------------------------------------------ ladder maths */

export interface ResolvedTranche extends TrancheSpec {
  /** Absolute price this tranche exits at. */
  price: number
  /** Tokens sold at this tranche. */
  tokens: number
  /** Proceeds if it fills. */
  proceeds: number
}

export interface LadderSummary {
  tranches: ResolvedTranche[]
  /** Share of the bag allocated to exits (sum of tranche percentages). */
  totalPct: number
  /** Percentage-weighted average exit price. */
  avgExitPrice: number | null
  /** Total proceeds if every tranche fills. */
  totalTargetValue: number
  /** Gain of totalTargetValue over the position's current market value. */
  gainVsCurrentPct: number | null
  /** Gain of totalTargetValue over what the position cost. */
  gainVsCostPct: number | null
  /** The next tranche that has not fired yet. */
  nextTranche: ResolvedTranche | null
  /** Fractional distance from the current price to the next tranche. */
  distanceToNext: number | null
}

/**
 * Turn a template into concrete prices for a position.
 *
 * `base` is the average cost basis where one is known, so "2x" means twice what
 * was actually paid. Callers fall back to the current price when there is no
 * buy history.
 */
export function resolveLadder(
  specs: TrancheSpec[],
  base: number,
  balance: number,
  currentPrice: number | null,
  costBasis: number | null,
  firedMultiples: number[] = [],
): LadderSummary {
  const tranches: ResolvedTranche[] = specs.map((t) => {
    const price = base * t.multiple
    const tokens = balance * (t.pct / 100)
    return { ...t, price, tokens, proceeds: tokens * price }
  })

  const totalPct = tranches.reduce((s, t) => s + t.pct, 0)
  const totalTargetValue = tranches.reduce((s, t) => s + t.proceeds, 0)

  const avgExitPrice =
    totalPct > 0 ? tranches.reduce((s, t) => s + t.price * t.pct, 0) / totalPct : null

  const currentValue = currentPrice !== null ? balance * currentPrice : null
  const gainVsCurrentPct =
    currentValue !== null && currentValue > 0 ? totalTargetValue / currentValue - 1 : null

  // Only the portion being sold is compared against cost, so the number means
  // "what this ladder returns on the money it exits".
  const costOfLadder = costBasis !== null ? balance * (totalPct / 100) * costBasis : null
  const gainVsCostPct =
    costOfLadder !== null && costOfLadder > 0 ? totalTargetValue / costOfLadder - 1 : null

  const fired = new Set(firedMultiples)
  const nextTranche =
    tranches.filter((t) => !fired.has(t.multiple)).sort((a, b) => a.price - b.price)[0] ?? null

  const distanceToNext =
    nextTranche && currentPrice !== null && currentPrice > 0
      ? (nextTranche.price - currentPrice) / currentPrice
      : null

  return {
    tranches,
    totalPct,
    avgExitPrice,
    totalTargetValue,
    gainVsCurrentPct,
    gainVsCostPct,
    nextTranche,
    distanceToNext,
  }
}

/* -------------------------------------------------- strategy suggestion */

export interface TokenHistoryStats {
  /** Standard deviation of period-over-period returns. */
  volatility: number | null
  /** Number of candles available — a proxy for how long it has traded. */
  ageDays: number | null
  /** Current price as a fraction below the all-time high in the window. */
  drawdownFromHigh: number | null
  /** Current price as a multiple of the window's low. */
  runFromLow: number | null
  liquidityUsd: number | null
}

export interface Suggestion {
  recommended: TemplateId
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
}

/** Volatility, drawdown and age from a candle series. */
export function analyzeHistory(
  candles: Array<{ time: number; close: number; high: number; low: number }>,
  liquidityUsd: number | null,
): TokenHistoryStats {
  if (candles.length < 2) {
    return { volatility: null, ageDays: null, drawdownFromHigh: null, runFromLow: null, liquidityUsd }
  }

  const closes = candles.map((c) => c.close).filter((c) => c > 0)
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1)

  const mean = returns.reduce((s, r) => s + r, 0) / (returns.length || 1)
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length || 1)
  const volatility = Math.sqrt(variance)

  const high = Math.max(...candles.map((c) => c.high))
  const low = Math.min(...candles.map((c) => c.low).filter((l) => l > 0))
  const last = closes[closes.length - 1]

  const spanSeconds = candles[candles.length - 1].time - candles[0].time

  return {
    volatility,
    ageDays: spanSeconds / 86_400,
    drawdownFromHigh: high > 0 ? 1 - last / high : null,
    runFromLow: low > 0 ? last / low : null,
    liquidityUsd,
  }
}

/**
 * Recommend a template from what the token has actually done.
 *
 * The logic is intentionally legible rather than clever: young + violent
 * suggests tail upside worth holding a runner for; calm + mature suggests
 * taking profit early; thin liquidity always pulls the exit earlier, because a
 * ladder you cannot actually fill is worse than no ladder.
 */
export function suggestTemplate(stats: TokenHistoryStats): Suggestion {
  const reasons: string[] = []
  const { volatility: vol, ageDays, drawdownFromHigh, runFromLow, liquidityUsd } = stats

  if (vol === null || ageDays === null) {
    return {
      recommended: 'x2x4',
      confidence: 'low',
      reasons: ['Not enough price history to judge — 2x & 4x is the balanced default.'],
    }
  }

  let score = 0 // higher = more upside worth holding for

  if (vol > 0.25) {
    score += 2
    reasons.push(`Highly volatile (${(vol * 100).toFixed(0)}% per candle) — big moves are in range.`)
  } else if (vol > 0.12) {
    score += 1
    reasons.push(`Moderately volatile (${(vol * 100).toFixed(0)}% per candle).`)
  } else {
    reasons.push(`Calm price action (${(vol * 100).toFixed(0)}% per candle) — large multiples are unlikely.`)
  }

  if (ageDays < 14) {
    score += 2
    reasons.push(`Only ${ageDays.toFixed(0)} days of history — early enough for a long tail.`)
  } else if (ageDays < 60) {
    score += 1
    reasons.push(`${ageDays.toFixed(0)} days of history.`)
  } else {
    reasons.push(`${ageDays.toFixed(0)} days of history — well past launch.`)
  }

  if (drawdownFromHigh !== null && drawdownFromHigh > 0.6) {
    score += 1
    reasons.push(`Down ${(drawdownFromHigh * 100).toFixed(0)}% from its high — room to recover.`)
  }

  if (runFromLow !== null && runFromLow > 8) {
    score -= 1
    reasons.push(`Already up ${runFromLow.toFixed(0)}x off the low — much of the move may be behind it.`)
  }

  // A ladder you cannot fill is worse than no ladder.
  if (liquidityUsd !== null && liquidityUsd < 25_000) {
    score -= 2
    reasons.push(
      `Only ${liquidityUsd < 1000 ? '<$1K' : `$${Math.round(liquidityUsd / 1000)}K`} liquidity — exit early, size will not fill.`,
    )
  }

  const recommended: TemplateId = score >= 4 ? 'x2x5x10' : score >= 2 ? 'x2x4' : 'scalp'

  // When even the lowest preset looks ambitious, say so rather than pretending
  // it fits — a custom ladder with closer targets is the honest answer.
  if (recommended === 'scalp' && score <= 0) {
    reasons.push('Little room left for a multiple — a custom ladder with closer targets may fit better.')
  }

  const confidence = ageDays < 3 ? 'low' : ageDays > 21 ? 'high' : 'medium'

  return { recommended, confidence, reasons }
}
