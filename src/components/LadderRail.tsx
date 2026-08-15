'use client'

import { useState } from 'react'
import type { TrancheRow } from '@/lib/types'
import type { RungState } from '@/lib/reconcile'
import { railGeometry } from '@/lib/rail'
import { formatPrice, formatPercent, formatUsd, formatAmount } from '@/lib/format'

/**
 * The ladder rail — the app's signature object.
 *
 * One axis showing the whole journey: cost basis → where price is now → each
 * exit rung. Positions are **logarithmic**, because a linear axis crushes 2x
 * and 5x into the left quarter when a 10x rung sets the scale; log spacing
 * makes "how much further to the next rung" readable at a glance, which is the
 * only question this app exists to answer.
 *
 * Used at two sizes: compact inside a position row, full inside the planner.
 */

export interface RailProps {
  costBasis: number | null
  price: number | null
  tranches: TrancheRow[]
  size?: 'compact' | 'full'
  /** Scaled total supply — lets each rung report the FDV it implies. */
  totalSupply?: number | null
  /** Token balance, so a rung can show what it actually sells. */
  balance?: number
  symbol?: string | null
  /** Reconciled state per rung price — 'reached' alone is not 'sold'. */
  states?: Map<number, RungState>
}

/** A rung reached but not sold is the case worth shouting about. */
const STATE_COLOR: Record<RungState, string> = {
  pending: 'var(--accent)',
  missed: 'var(--down)',
  partial: 'var(--accent)',
  sold: 'var(--up)',
}

const STATE_MARK: Record<RungState, string> = {
  pending: '',
  missed: '!',
  partial: '~',
  sold: '✓',
}

interface Mark {
  pos: number
  price: number
  label: string
  multiple: number
  pct: number
  fired: boolean
  state: RungState
  /** Horizontal nudge in px to keep the label clear of the price marker. */
  shift: number
}

/** Rungs closer than this to the marker get their labels nudged aside. */
const CLASH = 0.045

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 2 }}>
      <span className="lbl">{label}</span>
      <span className="num" style={{ fontSize: 11, color: accent ? 'var(--accent)' : 'var(--ink)' }}>
        {value}
      </span>
    </div>
  )
}

export function LadderRail({
  costBasis,
  price,
  tranches,
  size = 'full',
  totalSupply = null,
  balance = 0,
  symbol,
  states,
}: RailProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const rungs = [...tranches].sort((a, b) => a.price - b.price)
  const compact = size === 'compact'

  // Geometry lives in lib/rail.ts so the log positioning is unit tested.
  const geo = railGeometry(costBasis, price, rungs.map((t) => t.price))
  if (!geo || !costBasis) return null

  const { costPos, pricePos } = geo
  const top = rungs[rungs.length - 1].price

  const marks: Mark[] = rungs.map((t, i) => {
    const pos = geo.rungs[i].pos
    // The current-price marker sits on the rail and can hide a rung's label
    // when the two nearly coincide. Push the label to whichever side the rung
    // sits relative to the marker so both stay readable.
    const clash = pricePos !== null && Math.abs(pos - pricePos) < CLASH
    return {
      pos,
      price: t.price,
      label: `${t.multiple}x`,
      multiple: t.multiple,
      pct: t.pct,
      fired: t.fired === 1,
      state: states?.get(t.price) ?? (t.fired === 1 ? 'missed' : 'pending'),
      shift: clash ? (pos >= (pricePos ?? 0) ? 20 : -20) : 0,
    }
  })

  const inProfit = price != null && price >= costBasis
  const next = marks.find((m) => !m.fired)
  const distance = next && price && price > 0 ? (next.price - price) / price : null

  const H = compact ? 3 : 5

  return (
    <div style={{ width: '100%' }}>
      {/* rung labels above (full size only) */}
      {!compact && (
        <div style={{ position: 'relative', height: 30, marginBottom: 10 }}>
          {marks.map((m, i) => (
            <div
              key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                position: 'absolute',
                left: `${m.pos * 100}%`,
                transform: `translateX(calc(-50% + ${m.shift}px))`,
                textAlign: 'center',
                whiteSpace: 'nowrap',
                cursor: 'default',
                padding: '0 3px',
              }}
            >
              <div
                className="num"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: m.state === 'pending' ? 'var(--ink)' : STATE_COLOR[m.state],
                }}
              >
                {STATE_MARK[m.state]}
                {m.label}
              </div>
              <div className="lbl" style={{ fontSize: 9 }}>
                {m.pct}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* the rail */}
      <div style={{ position: 'relative', height: compact ? 14 : 22 }}>
        {/* base track */}
        <div
          style={{
            position: 'absolute',
            top: compact ? 5 : 8,
            left: 0,
            right: 0,
            height: H,
            background: 'var(--rule)',
          }}
        />

        {/* travelled: cost → now. Teal in profit, red under water. */}
        {pricePos !== null && (
          <div
            className="wipe"
            style={{
              position: 'absolute',
              top: compact ? 5 : 8,
              left: `${Math.min(costPos, pricePos) * 100}%`,
              width: `${Math.abs(pricePos - costPos) * 100}%`,
              height: H,
              background: inProfit ? 'var(--up)' : 'var(--down)',
            }}
          />
        )}

        {/* cost basis: a hard tick, the origin of every multiple */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${costPos * 100}%`,
            width: 1,
            height: '100%',
            background: 'var(--ink-2)',
          }}
        />

        {/* rungs — wide invisible hit area so the 2px tick is still hoverable */}
        {marks.map((m, i) => (
          <div
            key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: 'absolute',
              top: -6,
              bottom: -6,
              left: `${m.pos * 100}%`,
              width: 18,
              transform: 'translateX(-50%)',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: m.state === 'pending' ? 2 : 3,
                height: '100%',
                background: STATE_COLOR[m.state],
                opacity: hovered === i ? 1 : 0.95,
              }}
            />
          </div>
        ))}

        {/* current price marker — the only filled block on the rail */}
        {pricePos !== null && (
          <div
            style={{
              position: 'absolute',
              top: compact ? 1 : 2,
              left: `${pricePos * 100}%`,
              transform: 'translateX(-50%)',
              width: compact ? 7 : 9,
              height: compact ? 11 : 17,
              background: 'var(--ink)',
              border: '1px solid var(--black)',
            }}
          />
        )}
      </div>

      {/* rung tooltip — what this rung means in FDV, which is how these tokens
          are actually judged. Anchored to the rail, not the cursor. */}
      {!compact && hovered !== null && marks[hovered] && (
        <div
          style={{
            position: 'relative',
            height: 0,
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: `${marks[hovered].pos * 100}%`,
              transform: `translateX(${marks[hovered].pos > 0.72 ? '-100%' : marks[hovered].pos < 0.28 ? '0%' : '-50%'})`,
              background: 'var(--black)',
              border: '1px solid var(--rule-hi)',
              padding: '9px 11px',
              whiteSpace: 'nowrap',
              minWidth: 168,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span
                className="num"
                style={{ fontSize: 14, fontWeight: 700, color: STATE_COLOR[marks[hovered].state] }}
              >
                {marks[hovered].label}
              </span>
              <span className="lbl">SELL {marks[hovered].pct}%</span>
              <span className="lbl" style={{ color: STATE_COLOR[marks[hovered].state] }}>
                {marks[hovered].state === 'sold'
                  ? '✓ SOLD'
                  : marks[hovered].state === 'partial'
                    ? '~ PART SOLD'
                    : marks[hovered].state === 'missed'
                      ? '! HIT, NOT SOLD'
                      : 'PENDING'}
              </span>
            </div>

            <Line label="FDV" value={totalSupply ? formatUsd(marks[hovered].price * totalSupply) : '—'} accent />
            <Line label="PRICE" value={formatPrice(marks[hovered].price)} />
            {balance > 0 && (
              <>
                <Line
                  label="SELLS"
                  value={`${formatAmount((balance * marks[hovered].pct) / 100)} ${symbol ?? ''}`}
                />
                <Line
                  label="PROCEEDS"
                  value={formatUsd(((balance * marks[hovered].pct) / 100) * marks[hovered].price)}
                />
              </>
            )}
            {price && price > 0 && (
              <Line
                label="AWAY"
                value={formatPercent((marks[hovered].price - price) / price)}
              />
            )}
          </div>
        </div>
      )}

      {/* endpoints (full size only) */}
      {!compact && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 11,
            gap: 10,
          }}
        >
          <span className="lbl">
            AVG. COST <span className="num dim">{formatPrice(costBasis)}</span>
          </span>
          {distance !== null && next && (
            <span className="lbl lbl-hi">
              <span className="num acc">{formatPercent(distance)}</span> TO {next.label}
            </span>
          )}
          <span className="lbl">
            <span className="num dim">{formatPrice(top)}</span> TOP
          </span>
        </div>
      )}
    </div>
  )
}
