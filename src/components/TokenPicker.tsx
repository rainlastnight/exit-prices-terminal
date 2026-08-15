'use client'

import { useMemo, useState } from 'react'
import type { DiscoveredToken, Wallet } from '@/lib/types'
import { CHAINS } from '@/lib/chains'
import { formatAmount, formatUsd, shortAddress } from '@/lib/format'

/**
 * Wallet + token manager.
 *
 * Doubles as the place wallets are switched, made primary, or removed. The
 * dashboard itself stays a read-out, so every structural or destructive action
 * lives behind this one modal.
 */

interface Props {
  wallets: Wallet[]
  activeWalletId: number
  primaryWalletId: number | null
  tokens: DiscoveredToken[]
  /** key -> tracked row id, for tokens already being tracked. */
  trackedIds: Map<string, number>
  loading: boolean
  onSwitchWallet: (wallet: Wallet) => void
  onSetPrimary: (id: number | null) => void
  onRemoveWallet: (wallet: Wallet) => void
  onConfirm: (add: DiscoveredToken[], removeTrackedIds: number[]) => void
  onClose: () => void
}

const keyOf = (t: DiscoveredToken) => `${t.chainId}:${t.address.toLowerCase()}`

export function TokenPicker({
  wallets,
  activeWalletId,
  primaryWalletId,
  tokens,
  trackedIds,
  loading,
  onSwitchWallet,
  onSetPrimary,
  onRemoveWallet,
  onConfirm,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [chainFilter, setChainFilter] = useState<number | 'all'>('all')
  /** Keys switched ON this session (not currently tracked). */
  const [added, setAdded] = useState<Set<string>>(new Set())
  /** Keys switched OFF this session (currently tracked). */
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [confirmWallet, setConfirmWallet] = useState<number | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tokens.filter((t) => {
      if (chainFilter !== 'all' && t.chainId !== chainFilter) return false
      if (!q) return true
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      )
    })
  }, [tokens, query, chainFilter])

  const isOn = (t: DiscoveredToken) => {
    const k = keyOf(t)
    if (removed.has(k)) return false
    if (added.has(k)) return true
    return trackedIds.has(k)
  }

  const toggle = (t: DiscoveredToken) => {
    const k = keyOf(t)
    const set = trackedIds.has(k) ? setRemoved : setAdded
    set((prev) => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  const confirm = () =>
    onConfirm(
      tokens.filter((t) => added.has(keyOf(t))),
      [...removed].map((k) => trackedIds.get(k)).filter((id): id is number => id != null),
    )

  const dirty = added.size + removed.size > 0
  const active = wallets.find((w) => w.id === activeWalletId)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000000cc',
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel wipe"
        style={{
          width: 'min(780px, 100%)',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          borderColor: 'var(--rule-mid)',
        }}
      >
        <div className="panel-head">
          <span className="h2">Wallets &amp; tokens</span>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Close
          </button>
        </div>

        {/* ---------------------------------------------------------- wallets */}
        <div style={{ borderBottom: '1px solid var(--rule)' }}>
          {wallets.map((w) => {
            const isActive = w.id === activeWalletId
            const isPrimary = w.id === primaryWalletId
            const confirming = confirmWallet === w.id

            return (
              <div
                key={w.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--rule)',
                  background: isActive ? 'var(--surface-2)' : 'transparent',
                  borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                <button
                  onClick={() => onSwitchWallet(w)}
                  title="Show this wallet's tokens"
                  style={{
                    background: 'none',
                    border: 0,
                    padding: 0,
                    color: 'inherit',
                    font: 'inherit',
                    cursor: 'pointer',
                    textAlign: 'left',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>
                    {shortAddress(w.address)}
                  </span>
                  {w.label && (
                    <span className="lbl" style={{ marginLeft: 8 }}>
                      {w.label}
                    </span>
                  )}
                </button>

                <button
                  className="btn btn-sm"
                  data-on={isPrimary}
                  onClick={() => onSetPrimary(isPrimary ? null : w.id)}
                  title={isPrimary ? 'Show all wallets instead' : 'Show only this wallet on the dashboard'}
                >
                  {isPrimary ? '● Primary' : 'Set primary'}
                </button>

                {/* Removal drops every tracked token and exit plan from this
                    wallet, so it asks first. */}
                {confirming ? (
                  <>
                    <button
                      className="btn btn-sm"
                      style={{ borderColor: 'var(--down)', color: 'var(--down)' }}
                      onClick={() => {
                        onRemoveWallet(w)
                        setConfirmWallet(null)
                      }}
                    >
                      Remove?
                    </button>
                    <button className="btn btn-sm" onClick={() => setConfirmWallet(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => setConfirmWallet(w.id)}
                    title="Remove this wallet and everything tracked from it"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}

          {primaryWalletId !== null && (
            <div style={{ padding: '9px 16px' }}>
              <button className="btn btn-sm" onClick={() => onSetPrimary(null)}>
                Show all wallets
              </button>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------- filter */}
        <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            className="input"
            autoFocus
            placeholder="Filter by symbol, name or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="seg">
            {(['all', 1, 4663] as const).map((c) => (
              <button key={String(c)} data-on={chainFilter === c} onClick={() => setChainFilter(c)}>
                {c === 'all' ? 'All' : CHAINS[c].short}
              </button>
            ))}
          </div>
        </div>

        {/* ----------------------------------------------------------- tokens */}
        <div style={{ overflowY: 'auto', flex: 1, borderTop: '1px solid var(--rule)' }}>
          {loading && (
            <div className="lbl blink" style={{ padding: 36, textAlign: 'center' }}>
              Scanning {active ? shortAddress(active.address) : ''}…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="lbl" style={{ padding: 36, textAlign: 'center' }}>
              Nothing found
            </div>
          )}

          {!loading &&
            filtered.map((t) => {
              const k = keyOf(t)
              const on = isOn(t)
              const willRemove = removed.has(k)
              const willAdd = added.has(k)

              return (
                <button
                  key={k}
                  onClick={() => toggle(t)}
                  className="trow"
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr auto auto',
                    gap: 14,
                    alignItems: 'center',
                    padding: '11px 16px',
                    border: 0,
                    borderBottom: '1px solid var(--rule)',
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 15,
                      height: 15,
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--rule-hi)'}`,
                      background: on ? 'var(--accent)' : 'transparent',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 10,
                      color: 'var(--black)',
                      fontWeight: 700,
                    }}
                  >
                    {on ? '✓' : ''}
                  </span>

                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                      <span className="tag">
                        {CHAINS[t.chainId as keyof typeof CHAINS]?.short ?? t.chainId}
                      </span>
                      {willAdd && <span className="lbl acc">+ ADD</span>}
                      {willRemove && <span className="lbl down">− REMOVE</span>}
                    </span>
                    <span
                      className="lbl"
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textTransform: 'none',
                        letterSpacing: 0,
                      }}
                    >
                      {t.name}
                    </span>
                  </span>

                  <span className="num lbl">{formatAmount(t.balance)}</span>

                  <span className="num" style={{ fontSize: 13, minWidth: 74, textAlign: 'right' }}>
                    {t.hintValueUsd != null ? formatUsd(t.hintValueUsd) : <span className="dimmer">—</span>}
                  </span>
                </button>
              )
            })}
        </div>

        <footer
          style={{
            padding: '13px 16px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span className="lbl">
            {added.size > 0 && <span className="acc">+{added.size} </span>}
            {removed.size > 0 && <span className="down">−{removed.size} </span>}
            {filtered.length} SHOWN
          </span>
          <button className="btn btn-acc" disabled={!dirty} onClick={confirm}>
            {dirty ? 'Apply' : 'No changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
