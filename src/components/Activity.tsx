'use client'

import { useState } from 'react'
import type { PricedRow, PositionDetail } from '@/lib/types'
import { CHAINS } from '@/lib/chains'
import { formatAmount, formatPrice, formatUsd } from '@/lib/format'

/**
 * Every transfer of this token in and out of the wallet, newest first.
 *
 * This is the same history that produces the cost basis, so the log doubles as
 * a way to check it: if the average cost looks wrong, the offending row is
 * visible here. Transfers that could not be priced are listed with a dash
 * rather than hidden, since an incomplete log would misrepresent the position.
 */

interface Props {
  row: PricedRow
  detail: PositionDetail | null
}

const PAGE = 12

export function Activity({ row, detail }: Props) {
  const [expanded, setExpanded] = useState(false)

  const chain = CHAINS[row.chain_id as keyof typeof CHAINS]
  const trades = [...(detail?.trades ?? [])].sort((a, b) => b.ts - a.ts)

  /* FDV each trade implies, from the execution price. Uses today's supply, as
     every other FDV figure in the app does — supply at the time of an old
     transfer is not available from the price feed, so a mint or burn since
     then would shift these historical figures. */
  const supply = row.total_supply ? Number(row.total_supply) : null

  if (!detail) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="h2">Activity</span>
        </div>
        <div className="lbl blink" style={{ padding: 22, textAlign: 'center' }}>
          Reading transfers…
        </div>
      </div>
    )
  }

  const buys = trades.filter((t) => t.kind === 'buy').length
  const sells = trades.filter((t) => t.kind === 'sell').length
  const unpriced = trades.filter((t) => t.price === null).length
  const shown = expanded ? trades : trades.slice(0, PAGE)

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="h2">Activity</span>
        <span className="lbl" style={{ marginLeft: 'auto' }}>
          <span className="up">▲</span> {buys} BUY <span className="down">▼</span> {sells} SELL
        </span>
      </div>

      {trades.length === 0 ? (
        <div className="lbl" style={{ padding: 22, textAlign: 'center' }}>
          No transfers found for this wallet
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '76px 62px 1fr 1fr 1fr 22px',
              gap: 10,
              padding: '9px 16px',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span className="lbl">Date</span>
            <span className="lbl">Side</span>
            <span className="lbl" style={{ textAlign: 'right' }}>
              Amount
            </span>
            <span className="lbl" style={{ textAlign: 'right' }}>
              Price / FDV
            </span>
            <span className="lbl" style={{ textAlign: 'right' }}>
              Value
            </span>
            <span />
          </div>

          <div style={{ maxHeight: expanded ? 420 : undefined, overflowY: expanded ? 'auto' : undefined }}>
            {shown.map((t, i) => {
              const buy = t.kind === 'buy'
              const tokens = Math.abs(t.amount)
              const value = t.price !== null ? tokens * t.price : null

              return (
                <div
                  key={`${t.txHash}-${t.ts}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '76px 62px 1fr 1fr 1fr 22px',
                    gap: 10,
                    padding: '9px 16px',
                    borderBottom: '1px solid var(--rule)',
                    alignItems: 'center',
                  }}
                >
                  <span className="num lbl" style={{ letterSpacing: 0 }}>
                    {new Date(t.ts * 1000).toLocaleDateString(undefined, {
                      month: 'short',
                      day: '2-digit',
                    })}
                  </span>

                  <span
                    className="lbl"
                    style={{
                      color: buy ? 'var(--up)' : 'var(--down)',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span aria-hidden>{buy ? '▲' : '▼'}</span> {buy ? 'BUY' : 'SELL'}
                  </span>

                  <span className="num" style={{ fontSize: 12, textAlign: 'right' }}>
                    {buy ? '+' : '−'}
                    {formatAmount(tokens)}
                  </span>

                  <span style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 12 }}>
                      {t.price !== null ? (
                        formatPrice(t.price)
                      ) : (
                        <span className="dimmer" title="No candle data near this transfer">
                          —
                        </span>
                      )}
                    </div>
                    <div className="num lbl" style={{ marginTop: 2 }}>
                      {t.price !== null && supply !== null ? formatUsd(t.price * supply) : '—'}
                    </div>
                  </span>

                  <span className="num" style={{ fontSize: 12, textAlign: 'right' }}>
                    {value !== null ? formatUsd(value) : <span className="dimmer">—</span>}
                  </span>

                  {t.txHash ? (
                    <a
                      href={`${chain?.explorer}/tx/${t.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="lbl"
                      title="View transaction"
                      style={{ textDecoration: 'none', textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗
                    </a>
                  ) : (
                    <span />
                  )}
                </div>
              )
            })}
          </div>

          <div
            style={{
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span className="lbl">
              {shown.length} OF {trades.length}
              {/* Unpriced rows still count toward the balance, just not the cost basis. */}
              {unpriced > 0 && <span className="down"> · {unpriced} UNPRICED</span>}
            </span>
            {trades.length > PAGE && (
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show less' : `Show all ${trades.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
