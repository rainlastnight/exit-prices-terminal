'use client'

import { useMemo, useState } from 'react'
import type { PricedRow, PositionDetail } from '@/lib/types'
import { validateCustom, type CustomRow, type TemplateId, type TrancheSpec } from '@/lib/templates'
import { LadderRail } from './LadderRail'
import { usePref } from '@/lib/usePref'
import { formatPrice, formatUsd, formatPercent, formatAmount, parseThreshold } from '@/lib/format'

interface Props {
  row: PricedRow
  detail: PositionDetail | null
  onApply: (templateId: TemplateId) => void
  onApplyCustom: (tranches: TrancheSpec[]) => void
  onRebase: () => void
  onClear: () => void
  onSetCost: (value: number | null) => void
}

const BLANK: CustomRow = { multiple: '', pct: '' }

function Stat({
  label,
  value,
  sub,
  tone,
  big,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'up' | 'down' | 'acc'
  big?: boolean
}) {
  const color =
    tone === 'up'
      ? 'var(--up)'
      : tone === 'down'
        ? 'var(--down)'
        : tone === 'acc'
          ? 'var(--accent)'
          : 'var(--ink)'
  return (
    <div>
      <div className="lbl" style={{ marginBottom: 5 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: big ? 22 : 16, fontWeight: 700, color }}>
        {value}
      </div>
      {sub && (
        <div className="num lbl" style={{ marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export function ExitPlanner({ row, detail, onApply, onApplyCustom, onRebase, onClear, onSetCost }: Props) {
  const [editingCost, setEditingCost] = useState(false)
  const [costInput, setCostInput] = useState('')
  const [costError, setCostError] = useState<string | null>(null)

  // The custom ladder persists so it can be reused across positions rather
  // than retyped each time.
  const [customRows, setCustomRows] = usePref<CustomRow[]>('customLadder', [
    { multiple: '2', pct: '50' },
    { multiple: '3', pct: '50' },
  ])
  const [showCustom, setShowCustom] = useState(false)

  const custom = useMemo(() => validateCustom(customRows), [customRows])

  /* Reconciled rung states, keyed by price so the rail can colour each rung by
     what actually happened rather than by whether price merely reached it. */
  const rungStates = useMemo(
    () => new Map((detail?.fills ?? []).map((f) => [f.price, f.state])),
    [detail],
  )
  const missed = detail?.missed ?? []
  const soldPct = detail?.soldPct ?? 0
  const drift = detail?.drift ?? null
  // Below this the frozen rungs still describe the position well enough.
  const driftMatters = drift !== null && Math.abs(drift.drift) >= 0.02

  const setRow = (i: number, patch: Partial<CustomRow>) =>
    setCustomRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const pnl = detail?.pnl
  const ladder = detail?.ladder
  const suggestion = detail?.suggestion
  const tranches = row.tranches ?? []
  const hasLadder = tranches.length > 0

  // The FDV you effectively bought in at — same supply x price as the live FDV,
  // evaluated at your average cost.
  const supply = row.total_supply ? Number(row.total_supply) : null
  const avgFdv = pnl?.avgCost != null && supply !== null ? pnl.avgCost * supply : null

  const saveCost = () => {
    if (!costInput.trim()) {
      onSetCost(null)
      setEditingCost(false)
      setCostError(null)
      return
    }
    const v = parseThreshold(costInput)
    if (v === null) return setCostError('POSITIVE NUMBER, E.G. 0.012')
    onSetCost(v)
    setEditingCost(false)
    setCostError(null)
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* ------------------------------------------------------- the ladder */}
      <section className="panel">
        <div className="panel-head">
          <span className="h2">Exit ladder</span>
          <span className="lbl" style={{ marginLeft: 'auto' }}>
            {hasLadder ? `${Math.round(soldPct * 100)}% SOLD` : 'NONE SET'}
          </span>
          {hasLadder && (
            <button className="btn btn-sm" onClick={onClear}>
              Clear
            </button>
          )}
        </div>

        {hasLadder && ladder ? (
          <>
            {/* Price reached these rungs and nothing was sold. Previously this
                showed as "filled", which hid the miss entirely. */}
            {missed.length > 0 && (
              <div
                style={{
                  padding: '11px 18px',
                  borderBottom: '1px solid var(--rule)',
                  background: 'var(--down-dim)',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                }}
              >
                <span className="lbl down">! MISSED</span>
                <span className="lbl" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  Price reached {missed.map((m) => `${m.multiple}x`).join(', ')} but no sale was
                  found on-chain.
                </span>
              </div>
            )}

            {/* Rung prices are frozen at apply time, so a later buy silently
                makes the multiples describe an old cost basis. */}
            {driftMatters && drift && (
              <div
                style={{
                  padding: '11px 18px',
                  borderBottom: '1px solid var(--rule)',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span className="lbl acc">⚠ STALE BASE</span>
                <span className="lbl num" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  Built on {formatPrice(drift.planBase)}, cost is now{' '}
                  {formatPrice(drift.currentBase)} ({formatPercent(drift.drift)})
                </span>
                <button className="btn btn-sm btn-acc" style={{ marginLeft: 'auto' }} onClick={onRebase}>
                  Re-base
                </button>
              </div>
            )}

            <div style={{ padding: '20px 18px 14px' }}>
              <LadderRail
                costBasis={pnl?.avgCost ?? null}
                price={row.price}
                tranches={tranches}
                totalSupply={supply}
                balance={row.balance}
                symbol={row.symbol}
                states={rungStates}
              />
            </div>

            <hr className="hr" />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(108px,1fr))',
                gap: 18,
                padding: 18,
              }}
            >
              <Stat
                label="To next"
                value={ladder.distanceToNext != null ? formatPercent(ladder.distanceToNext) : '—'}
                sub={ladder.nextTranche ? `${ladder.nextTranche.multiple}X ${formatPrice(ladder.nextTranche.price)}` : 'ALL REACHED'}
                tone="acc"
                big
              />
              <Stat
                label="Allocated"
                value={`${ladder.totalPct}%`}
                sub={`${formatAmount((row.balance * ladder.totalPct) / 100)} ${row.symbol ?? ''}`}
              />
              <Stat
                label="Avg exit"
                value={formatPrice(ladder.avgExitPrice)}
                sub={
                  ladder.avgExitPrice != null && supply !== null
                    ? `${formatUsd(ladder.avgExitPrice * supply)} FDV`
                    : undefined
                }
              />
              <Stat
                label="Target value"
                value={formatUsd(ladder.totalTargetValue)}
                sub={ladder.gainVsCurrentPct != null ? `${formatPercent(ladder.gainVsCurrentPct)} VS NOW` : undefined}
                tone="up"
              />
            </div>
          </>
        ) : (
          <div style={{ padding: '26px 18px', textAlign: 'center' }}>
            <div className="lbl">Pick a formula below</div>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- position */}
      <section className="panel">
        <div className="panel-head">
          <span className="h2">Position</span>
          <span className="lbl" style={{ marginLeft: 'auto' }}>
            {formatAmount(row.balance)} {row.symbol}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))',
            gap: 18,
            padding: 18,
          }}
        >
          <Stat
            label="Value"
            value={formatUsd(row.valueUsd)}
            sub={pnl?.costValue != null ? `${formatUsd(pnl.costValue)} INVESTED` : undefined}
          />
          <Stat
            label="Unrealised"
            value={pnl?.unrealized != null ? formatUsd(pnl.unrealized) : '—'}
            sub={pnl?.unrealizedPct != null ? formatPercent(pnl.unrealizedPct) : undefined}
            tone={pnl?.unrealized == null ? undefined : pnl.unrealized >= 0 ? 'up' : 'down'}
          />
          <Stat
            label="Realised"
            value={pnl?.realized ? formatUsd(pnl.realized) : '—'}
            tone={pnl?.realized ? (pnl.realized >= 0 ? 'up' : 'down') : undefined}
          />
          <div>
            <div className="lbl" style={{ marginBottom: 5 }}>
              Avg. cost
            </div>
            {editingCost ? (
              <div style={{ display: 'flex', gap: 5 }}>
                <input
                  className="input"
                  autoFocus
                  style={{ padding: '5px 8px', fontSize: 12 }}
                  value={costInput}
                  placeholder={pnl?.avgCost ? String(pnl.avgCost) : '0.00'}
                  onChange={(e) => setCostInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveCost()}
                />
                <button className="btn btn-sm btn-solid" onClick={saveCost}>
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setEditingCost(true)
                  setCostInput(row.avg_cost_manual != null ? String(row.avg_cost_manual) : '')
                }}
                title="Click to override"
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                }}
              >
                <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>
                  {formatPrice(pnl?.avgCost ?? null)}
                </div>
                <div className="num lbl" style={{ marginTop: 3 }}>
                  {avgFdv !== null ? `${formatUsd(avgFdv)} FDV` : '— FDV'}
                </div>
                <div className="lbl" style={{ marginTop: 2, color: 'var(--accent)' }}>
                  {detail?.baseSource === 'manual'
                    ? 'MANUAL · EDIT'
                    : detail?.baseSource === 'estimated'
                      ? 'EST · EDIT'
                      : 'SET'}
                </div>
              </button>
            )}
          </div>
        </div>

        {costError && (
          <div className="lbl" style={{ color: 'var(--down)', padding: '0 18px 14px' }}>
            {costError}
          </div>
        )}

        {detail?.costPartial && detail.baseSource === 'estimated' && (
          <div
            className="lbl"
            style={{ padding: '0 18px 16px', lineHeight: 1.6, textTransform: 'none', letterSpacing: 0 }}
          >
            Estimated from {detail.transferCount} on-chain transfer
            {detail.transferCount === 1 ? '' : 's'}. Some could not be priced, and airdrops look like
            buys — click to correct.
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- formulas */}
      <section className="panel">
        <div className="panel-head">
          <span className="h2">Formula</span>
          <span className="lbl" style={{ marginLeft: 'auto' }}>
            FROM {detail?.baseSource === 'price' ? 'PRICE' : 'AVG. COST'} {formatPrice(detail?.base ?? null)}
          </span>
        </div>

        {suggestion && (
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--rule)' }}>
            <div className="lbl" style={{ color: 'var(--accent)', marginBottom: 7 }}>
              ◆ Suggested — {detail!.previews.find((p) => p.id === suggestion.recommended)?.name} ·{' '}
              {suggestion.confidence} confidence
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 14,
                color: 'var(--ink-2)',
                fontSize: 12,
                lineHeight: 1.65,
              }}
            >
              {suggestion.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          {(detail?.previews ?? []).map((p) => {
            const active = row.template_id === p.id
            const recommended = suggestion?.recommended === p.id
            return (
              <button
                key={p.id}
                onClick={() => onApply(p.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: active ? 'var(--surface-2)' : 'transparent',
                  border: 0,
                  borderBottom: '1px solid var(--rule)',
                  borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  padding: '14px 18px',
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                  <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>
                    {p.name}
                  </span>
                  {recommended && (
                    <span
                      className="tag"
                      style={{ background: 'var(--accent)', color: 'var(--black)', borderColor: 'var(--accent)', fontWeight: 700 }}
                    >
                      Suggested
                    </span>
                  )}
                  {active && <span className="tag">Active</span>}
                  <span className="num" style={{ marginLeft: 'auto', color: 'var(--up)', fontSize: 13 }}>
                    → {formatUsd(p.summary.totalTargetValue)}
                  </span>
                </div>
                <div className="lbl" style={{ textTransform: 'none', letterSpacing: 0, marginBottom: 8 }}>
                  {p.blurb}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {p.summary.tranches.map((t, i) => (
                    <span key={i} className="tag num">
                      {t.pct}% @ {formatPrice(t.price)}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}

          {/* ------------------------------------------------------ custom */}
          <div
            style={{
              borderLeft: `3px solid ${showCustom ? 'var(--accent)' : 'transparent'}`,
              background: showCustom ? 'var(--surface-2)' : 'transparent',
            }}
          >
            <button
              onClick={() => setShowCustom((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 0,
                padding: '14px 18px',
                cursor: 'pointer',
                color: 'inherit',
                font: 'inherit',
              }}
            >
              <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>
                Custom
              </span>
              <span className="lbl" style={{ textTransform: 'none', letterSpacing: 0 }}>
                Build your own ladder
              </span>
              <span className="lbl" style={{ marginLeft: 'auto' }}>
                {showCustom ? '−' : '+'}
              </span>
            </button>

            {showCustom && (
              <div style={{ padding: '0 18px 16px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr auto auto',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <span className="lbl">Multiple</span>
                  <span className="lbl">Sell %</span>
                  <span className="lbl" style={{ minWidth: 78, textAlign: 'right' }}>
                    Price
                  </span>
                  <span style={{ width: 26 }} />
                </div>

                {customRows.map((r, i) => {
                  const m = Number(r.multiple)
                  const price =
                    Number.isFinite(m) && m > 0 && detail?.base ? detail.base * m : null
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr auto auto',
                        gap: 8,
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <input
                        className="input"
                        style={{ padding: '6px 9px', fontSize: 12 }}
                        placeholder="2"
                        inputMode="decimal"
                        value={r.multiple}
                        onChange={(e) => setRow(i, { multiple: e.target.value })}
                      />
                      <input
                        className="input"
                        style={{ padding: '6px 9px', fontSize: 12 }}
                        placeholder="50"
                        inputMode="decimal"
                        value={r.pct}
                        onChange={(e) => setRow(i, { pct: e.target.value })}
                      />
                      <span
                        className="num lbl"
                        style={{ minWidth: 78, textAlign: 'right' }}
                        title={price && supply ? `${formatUsd(price * supply)} FDV` : undefined}
                      >
                        {price !== null ? formatPrice(price) : '—'}
                      </span>
                      <button
                        className="btn btn-sm"
                        style={{ border: 0, color: 'var(--ink-3)', padding: '2px 6px', width: 26 }}
                        aria-label={`Remove rung ${i + 1}`}
                        onClick={() =>
                          setCustomRows((rows) =>
                            rows.length > 1 ? rows.filter((_, j) => j !== i) : [BLANK],
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => setCustomRows((rows) => [...rows, BLANK])}
                  >
                    + Rung
                  </button>

                  <span className="lbl" style={{ marginLeft: 'auto' }}>
                    {/* Allocating under 100% is allowed — the remainder is simply kept. */}
                    {custom.totalPct}% ALLOCATED
                    {custom.ok && custom.totalPct < 100 && (
                      <span className="acc"> · {100 - custom.totalPct}% KEPT</span>
                    )}
                  </span>

                  <button
                    className="btn btn-sm btn-acc"
                    disabled={!custom.ok}
                    onClick={() => onApplyCustom(custom.tranches)}
                  >
                    Apply
                  </button>
                </div>

                {custom.errors.length > 0 && (
                  <ul
                    style={{
                      margin: '10px 0 0',
                      paddingLeft: 14,
                      color: 'var(--down)',
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}
                  >
                    {custom.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
