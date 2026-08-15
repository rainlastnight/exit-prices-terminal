'use client'

import type { PricedRow } from '@/lib/types'
import { CHAINS } from '@/lib/chains'
import { LadderRail } from './LadderRail'
import { formatAmount, formatPrice, formatUsd, formatPercent } from '@/lib/format'

interface Props {
  row: PricedRow
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
  /** Detail panels, revealed nested beneath the row when expanded. */
  children?: React.ReactNode
}

export function PositionRow({ row, expanded, onToggle, onRemove, children }: Props) {
  const chain = CHAINS[row.chain_id as keyof typeof CHAINS]
  const noFeed = row.price === null
  const change = row.change24h != null ? row.change24h / 100 : null

  const pnl =
    row.avgCost != null && row.price != null ? (row.price - row.avgCost) * row.balance : null
  const pnlPct =
    row.avgCost != null && row.price != null && row.avgCost > 0 ? row.price / row.avgCost - 1 : null

  const tranches = row.tranches ?? []
  const done = tranches.filter((t) => t.fired === 1).length

  return (
    <div className="trow" data-selected={expanded}>
      <div onClick={onToggle} style={{ padding: '14px 16px', cursor: 'pointer' }}>
      <div
        style={{
          display: 'grid',
          // The rail gets its own column between the name and the price, so it
          // scales with the row instead of spanning the full width beneath it.
          gridTemplateColumns:
            'minmax(104px,0.85fr) minmax(150px,1.5fr) minmax(88px,0.85fr) minmax(96px,0.9fr) minmax(104px,0.9fr) 26px',
          gap: 14,
          alignItems: 'center',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* Disclosure marker — the row is the control now. */}
            <span
              aria-hidden
              className="acc"
              style={{
                fontSize: 10,
                width: 9,
                display: 'inline-block',
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            >
              ▶
            </span>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>
              {row.symbol ?? '???'}
            </span>
            <span className="tag">{chain?.short ?? row.chain_id}</span>
          </div>
          <div className="num lbl" style={{ marginTop: 3, letterSpacing: '0.06em' }}>
            {formatAmount(row.balance)}
          </div>
        </div>

        {/* Ladder, inline. Hidden when expanded because the full-size rail sits
            directly below; the empty cell keeps the columns aligned. */}
        <div style={{ minWidth: 0 }}>
          {!expanded && tranches.length > 0 && (
            <>
              <LadderRail
                costBasis={row.avgCost}
                price={row.price}
                tranches={tranches}
                size="compact"
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  // Rung ticks overhang the rail by 6px, so the labels need to
                  // clear that before they start, not just clear the rail.
                  marginTop: 10,
                }}
              >
                <span className="num lbl">{formatPrice(row.avgCost)}</span>
                <span className="lbl" style={{ color: done > 0 ? 'var(--up)' : undefined }}>
                  {done}/{tranches.length}
                </span>
                <span className="num lbl">
                  {formatPrice(Math.max(...tranches.map((t) => t.price)))}
                </span>
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 14 }}>
            {noFeed ? <span className="dimmer">NO FEED</span> : formatPrice(row.price)}
          </div>
          {change !== null && (
            <div className="num lbl" style={{ marginTop: 3, color: change >= 0 ? 'var(--up)' : 'var(--down)' }}>
              <span aria-hidden>{change >= 0 ? '▲' : '▼'}</span> {formatPercent(change)}
            </div>
          )}
        </div>

        {/* FDV leads. Market cap is null for most long-tail tokens and is shown
            as a dash rather than falling back to FDV under the wrong label. */}
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 14 }}>
            {formatUsd(row.fdv)}
          </div>
          <div className="lbl" style={{ marginTop: 3 }}>
            FDV{row.mc != null && ` · MC ${formatUsd(row.mc)}`}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 14 }}>
            {formatUsd(row.valueUsd)}
          </div>
          {pnl !== null ? (
            <div
              className="num lbl"
              style={{ marginTop: 3, color: pnl >= 0 ? 'var(--up)' : 'var(--down)' }}
            >
              {pnl >= 0 ? '+' : ''}
              {formatUsd(pnl)} {pnlPct !== null && formatPercent(pnlPct)}
            </div>
          ) : (
            <div className="lbl" style={{ marginTop: 3 }}>
              VALUE
            </div>
          )}
        </div>

        <button
          className="btn btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Stop tracking ${row.symbol}`}
          style={{ border: 0, color: 'var(--ink-3)', padding: '2px 5px' }}
        >
          ✕
        </button>
      </div>

      </div>

      {expanded && children && (
        <div
          style={{
            padding: '0 16px 18px',
            borderTop: '1px solid var(--rule)',
            marginTop: 2,
            paddingTop: 16,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
