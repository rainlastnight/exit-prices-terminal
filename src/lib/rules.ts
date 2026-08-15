/**
 * Pure exit-rule evaluation. Kept dependency-free so it can be unit tested
 * directly — this is where the two subtlest bugs live (double-firing, and
 * evaluating against a missing price).
 */

export type RuleMetric = 'price' | 'fdv'
export type TriggerDirection = 'up' | 'down'

export interface Rule {
  metric: RuleMetric
  targetUp: number | null
  stopDown: number | null
  firedUp: boolean
  firedDown: boolean
}

export interface Observation {
  price: number | null
  fdv: number | null
}

export interface Trigger {
  direction: TriggerDirection
  metric: RuleMetric
  threshold: number
  value: number
}

/** The value a rule is measured against, or null when unavailable. */
export function metricValue(rule: Rule, obs: Observation): number | null {
  const v = rule.metric === 'fdv' ? obs.fdv : obs.price
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Decide whether a rule fires. Returns null when nothing should fire.
 *
 * Never fires on a missing/NaN value — a token with no price feed must stay
 * silent rather than alerting on a phantom 0.
 */
export function evaluateRule(rule: Rule, obs: Observation): Trigger | null {
  const value = metricValue(rule, obs)
  if (value === null) return null

  if (rule.targetUp !== null && !rule.firedUp && value >= rule.targetUp) {
    return { direction: 'up', metric: rule.metric, threshold: rule.targetUp, value }
  }

  if (rule.stopDown !== null && !rule.firedDown && value <= rule.stopDown) {
    return { direction: 'down', metric: rule.metric, threshold: rule.stopDown, value }
  }

  return null
}

/**
 * Whether editing a rule should clear its latches, so an edited threshold can
 * fire again. Any change to the thresholds or the metric re-arms the rule.
 */
export function shouldRearm(
  prev: Pick<Rule, 'metric' | 'targetUp' | 'stopDown'>,
  next: Pick<Rule, 'metric' | 'targetUp' | 'stopDown'>,
): { up: boolean; down: boolean } {
  const metricChanged = prev.metric !== next.metric
  return {
    up: metricChanged || prev.targetUp !== next.targetUp,
    down: metricChanged || prev.stopDown !== next.stopDown,
  }
}

/**
 * Signed progress from the current value toward a threshold, as a fraction.
 * 0 = at the current value, 1 = threshold reached. Used for the distance pills.
 */
export function distanceToThreshold(value: number | null, threshold: number | null): number | null {
  if (value === null || threshold === null || !Number.isFinite(value) || value <= 0) return null
  return (threshold - value) / value
}

/**
 * Convert an FDV threshold into its price-axis equivalent, so it can be drawn
 * on a price chart. Returns null when supply is unknown.
 */
export function fdvThresholdAsPrice(threshold: number, totalSupply: number | null): number | null {
  if (totalSupply === null || !Number.isFinite(totalSupply) || totalSupply <= 0) return null
  return threshold / totalSupply
}
