'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PositionRow } from '@/components/PositionRow'
import { TokenPicker } from '@/components/TokenPicker'
import { PriceChart } from '@/components/PriceChart'
import { ExitPlanner } from '@/components/ExitPlanner'
import { AlertToast, alertKey, type FiredAlert } from '@/components/AlertToast'
import type { DiscoveredToken, PositionDetail, PricedRow, Wallet } from '@/lib/types'
import type { TemplateId, TrancheSpec } from '@/lib/templates'
import { formatUsd, formatPercent, isValidAddress, shortAddress } from '@/lib/format'
import { usePref } from '@/lib/usePref'

const POLL_MS = 30_000

/** Both chains settle in ETH, so a USD total also reads as an ETH total. */
function ethLabel(usd: number | null, ethPrice: number | null): string | undefined {
  if (usd == null || !ethPrice || ethPrice <= 0) return undefined
  const eth = usd / ethPrice
  const digits = Math.abs(eth) >= 100 ? 2 : Math.abs(eth) >= 1 ? 3 : 4
  // The rate is quoted exactly — formatUsd would round 1881.11 to "$1.9K",
  // which is useless as a price.
  const rate = ethPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `Ξ ${eth.toFixed(digits)} ETH  ·  @ $${rate}/ETH`
}

/** Segmented progress meter — hard blocks, no rounded fill. */
function Meter({ value, segments = 20 }: { value: number; segments?: number }) {
  const on = Math.round(value * segments)
  return (
    <div style={{ display: 'flex', gap: 2 }} aria-hidden>
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 6,
            background: i < on ? 'var(--accent)' : 'var(--rule)',
          }}
        />
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [allRows, setAllRows] = useState<PricedRow[]>([])
  /** null = show every wallet. */
  const [primaryWalletId, setPrimaryWalletId] = usePref<number | null>('primaryWallet', null)
  const [selectedId, setSelectedId, prefsLoaded] = usePref<number | null>('selectedId', null)
  const [detail, setDetail] = useState<PositionDetail | null>(null)
  const [alerts, setAlerts] = useState<FiredAlert[]>([])

  const [address, setAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [picker, setPicker] = useState<{ walletId: number; tokens: DiscoveredToken[] } | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)

  const [ethPrice, setEthPrice] = useState<number | null>(null)
  const [lastPoll, setLastPoll] = useState<number | null>(null)
  const [polling, setPolling] = useState(false)
  const seenAlerts = useRef<Set<string>>(new Set())

  const [notifyState, setNotifyState] = useState<NotificationPermission | 'unsupported' | null>(null)
  useEffect(() => {
    setNotifyState('Notification' in window ? Notification.permission : 'unsupported')
  }, [])

  /* ------------------------------------------------------------- data */

  const loadWallets = useCallback(async () => {
    const r = await fetch('/api/wallets').then((x) => x.json())
    setWallets(r.wallets ?? [])
  }, [])

  const notify = (fired: FiredAlert[]) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    for (const a of fired) {
      new Notification(`${a.symbol ?? 'Token'} ${a.direction === 'up' ? 'hit target' : 'hit stop'}`, {
        body: `${a.metric} · ${a.value} ${a.direction === 'up' ? '≥' : '≤'} ${a.threshold}`,
        tag: `exit-${a.trackedId}-${a.threshold}`,
      })
    }
  }

  const poll = useCallback(async () => {
    setPolling(true)
    try {
      const r = await fetch('/api/prices').then((x) => x.json())
      setAllRows(r.rows ?? [])
      setEthPrice(r.ethPrice ?? null)
      setLastPoll(r.at ?? Date.now())

      const fresh: FiredAlert[] = (r.alerts ?? [])
        .map((a: Omit<FiredAlert, 'key'>) => ({ ...a, key: alertKey(a) }))
        .filter((a: FiredAlert) => {
          if (seenAlerts.current.has(a.key)) return false
          seenAlerts.current.add(a.key)
          return true
        })

      if (fresh.length > 0) {
        setAlerts((prev) => {
          const seen = new Set(fresh.map((a) => a.key))
          return [...fresh, ...prev.filter((a) => !seen.has(a.key))].slice(0, 5)
        })
        notify(fresh)
      }
    } finally {
      setPolling(false)
    }
  }, [])

  useEffect(() => {
    loadWallets()
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [loadWallets, poll])

  const loadDetail = useCallback(async (id: number) => {
    const d = await fetch(`/api/position?id=${id}`).then((x) => x.json())
    setDetail(d.error ? null : d)
  }, [])

  useEffect(() => {
    if (selectedId === null) return setDetail(null)
    setDetail(null)
    loadDetail(selectedId)
  }, [selectedId, loadDetail])

  /* A primary wallet scopes the whole dashboard to that wallet; null shows
     everything. Totals and plan progress follow the same filter, so the
     headline always describes what is on screen. */
  const rows = useMemo(
    () => (primaryWalletId === null ? allRows : allRows.filter((r) => r.wallet_id === primaryWalletId)),
    [allRows, primaryWalletId],
  )

  const triggeredCount = rows.reduce(
    (n, r) => n + (r.tranches ?? []).filter((t) => t.fired === 1).length,
    0,
  )
  useEffect(() => {
    document.title = triggeredCount > 0 ? `(${triggeredCount}) Exit Prices` : 'Exit Prices'
  }, [triggeredCount])

  /* Opens one position on first load so the dashboard isn't a wall of collapsed
     rows. It must run once only — otherwise collapsing a row would immediately
     re-open it, and the accordion could never be fully closed. */
  const autoOpened = useRef(false)

  useEffect(() => {
    if (!prefsLoaded || rows.length === 0) return

    // A selection pointing at a row that no longer exists is released, not
    // replaced — the user did not ask for a different position.
    if (selectedId !== null && !rows.some((r) => r.id === selectedId)) {
      setSelectedId(null)
      autoOpened.current = true
      return
    }

    if (autoOpened.current || selectedId !== null) return
    autoOpened.current = true

    // Prefer a position with a plan running — that is what this app is for —
    // and fall back to the largest holding.
    const byValue = [...rows].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    const laddered = byValue.find((r) => (r.tranches ?? []).length > 0)
    setSelectedId((laddered ?? byValue[0]).id)
  }, [rows, selectedId, prefsLoaded, setSelectedId])

  /* ---------------------------------------------------------- actions */

  const addWallet = async () => {
    if (!isValidAddress(address)) return setAddError('INVALID ADDRESS')
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: address.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not add wallet')
      await loadWallets()
      setAddress('')
      openPicker(data.wallet)
    } catch (e) {
      setAddError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  const openPicker = async (wallet: Wallet) => {
    setPicker({ walletId: wallet.id, tokens: [] })
    setPickerLoading(true)
    try {
      const d = await fetch(`/api/tokens?address=${wallet.address}`).then((x) => x.json())
      setPicker({ walletId: wallet.id, tokens: d.tokens ?? [] })
    } finally {
      setPickerLoading(false)
    }
  }

  /** Apply the modal's pending adds and removals in one go. */
  const applyTokenChanges = async (
    walletId: number,
    add: DiscoveredToken[],
    removeIds: number[],
  ) => {
    if (add.length > 0) {
      await fetch('/api/tracked', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokens: add.map((t) => ({
            walletId,
            chainId: t.chainId,
            tokenAddress: t.address,
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            iconUrl: t.iconUrl,
            balanceRaw: t.balanceRaw,
          })),
        }),
      })
    }

    await Promise.all(
      removeIds.map((id) => fetch(`/api/tracked?id=${id}`, { method: 'DELETE' })),
    )

    if (selectedId !== null && removeIds.includes(selectedId)) setSelectedId(null)
    setPicker(null)
    poll()
  }

  const removeWallet = async (wallet: Wallet) => {
    await fetch(`/api/wallets?id=${wallet.id}`, { method: 'DELETE' })
    // Everything tracked from it cascades away, so any selection or filter
    // pointing at this wallet has to be released too.
    if (primaryWalletId === wallet.id) setPrimaryWalletId(null)
    setSelectedId(null)

    const remaining = wallets.filter((w) => w.id !== wallet.id)
    await loadWallets()
    await poll()

    if (picker?.walletId === wallet.id) {
      if (remaining.length > 0) openPicker(remaining[0])
      else setPicker(null)
    }
  }

  const applyTemplate = async (templateId: TemplateId) => {
    if (selectedId === null) return
    setActionError(null)

    const res = await fetch('/api/tranches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackedId: selectedId, templateId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setActionError(body.error ?? 'Could not apply that template')
      return
    }

    for (const k of [...seenAlerts.current]) {
      if (k.startsWith(`${selectedId}:`)) seenAlerts.current.delete(k)
    }
    await poll()
    loadDetail(selectedId)
  }

  /** Custom ladders go through the same tranche path as the presets. */
  const applyCustom = async (tranches: TrancheSpec[]) => {
    if (selectedId === null) return
    setActionError(null)

    const res = await fetch('/api/tranches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackedId: selectedId, tranches }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setActionError(body.error ?? 'Could not apply that ladder')
      return
    }

    for (const k of [...seenAlerts.current]) {
      if (k.startsWith(`${selectedId}:`)) seenAlerts.current.delete(k)
    }
    await poll()
    loadDetail(selectedId)
  }

  /** Re-apply the current ladder's multiples at today's cost basis. */
  const rebaseLadder = async () => {
    if (selectedId === null || !detail) return
    const specs = detail.tranches.map((t) => ({ multiple: t.multiple, pct: t.pct }))
    if (specs.length === 0) return
    await applyCustom(specs)
  }

  const clearLadder = async () => {
    if (selectedId === null) return
    await fetch(`/api/tranches?trackedId=${selectedId}`, { method: 'DELETE' })
    await poll()
    loadDetail(selectedId)
  }

  const setCost = async (value: number | null) => {
    if (selectedId === null) return
    await fetch('/api/tranches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackedId: selectedId, avgCostManual: value }),
    })
    await poll()
    loadDetail(selectedId)
  }

  const removeRow = async (id: number) => {
    await fetch(`/api/tracked?id=${id}`, { method: 'DELETE' })
    if (selectedId === id) setSelectedId(null)
    poll()
  }

  /* ----------------------------------------------------------- derived */

  const summary = useMemo(() => {
    let value = 0
    let cost = 0
    let costed = 0
    let realized = 0

    // Plan progress: share of laddered value whose rungs have filled. This is
    // the one headline no generic portfolio tracker can show.
    let planWeight = 0
    let planFilled = 0

    // Nearest unfilled rung across the whole portfolio.
    let nearest: { symbol: string; multiple: number; distance: number } | null = null

    for (const r of rows) {
      value += r.valueUsd ?? 0
      realized += r.realized_pnl ?? 0
      if (r.avgCost != null && r.price != null) {
        cost += r.avgCost * r.balance
        costed += r.valueUsd ?? 0
      }

      const tr = r.tranches ?? []
      if (tr.length > 0) {
        // Counted from rungs price has *reached*. The per-position panel
        // reconciles this against real sells; doing that for every position
        // here would mean a transfer-history fetch per row on every poll.
        const total = tr.reduce((s, t) => s + t.pct, 0)
        const reached = tr.filter((t) => t.fired === 1).reduce((s, t) => s + t.pct, 0)
        const w = r.valueUsd ?? 0
        if (total > 0 && w > 0) {
          planWeight += w
          planFilled += w * (reached / total)
        }

        if (r.price && r.price > 0) {
          for (const t of tr) {
            if (t.fired === 1) continue
            const d = (t.price - r.price) / r.price
            if (d >= 0 && (nearest === null || d < nearest.distance)) {
              nearest = { symbol: r.symbol ?? '???', multiple: t.multiple, distance: d }
            }
          }
        }
      }
    }

    const pnl = costed > 0 ? costed - cost : null
    return {
      value,
      // What the currently-held tokens cost. Positions with no cost basis are
      // excluded rather than counted as free, so this can understate.
      invested: cost > 0 ? cost : null,
      realized,
      pnl,
      pnlPct: pnl !== null && cost > 0 ? pnl / cost : null,
      planProgress: planWeight > 0 ? planFilled / planWeight : null,
      nearest,
    }
  }, [rows])

  const unpriced = rows.filter((r) => r.price === null).length
  /* Keyed by chain+address so the modal can both recognise a tracked token and
     untrack it. Built from the unfiltered set, since the modal manages the
     active wallet regardless of which one is primary. */
  const trackedIds = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of allRows) {
      if (picker && r.wallet_id !== picker.walletId) continue
      m.set(`${r.chain_id}:${r.token_address.toLowerCase()}`, r.id)
    }
    return m
  }, [allRows, picker])

  /* -------------------------------------------------------------- view */

  return (
    <main style={{ minHeight: '100vh', maxWidth: 1600, margin: '0 auto', padding: '0 20px 48px' }}>
      {/* masthead */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 0 14px',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[14, 20, 26].map((w) => (
            <span key={w} style={{ display: 'block', width: w, height: 2, background: 'var(--accent)' }} />
          ))}
        </span>
        <span style={{ fontWeight: 800, letterSpacing: '0.2em', fontSize: 13 }}>
          EXIT PRICES <span className="dimmer">TERMINAL</span>
        </span>
        <span className="lbl" style={{ marginLeft: 'auto' }}>
          {polling ? 'SYNC' : lastPoll ? new Date(lastPoll).toLocaleTimeString() : 'LIVE'}
        </span>
        <span
          className={polling ? 'blink' : ''}
          style={{ width: 7, height: 7, background: polling ? 'var(--accent)' : 'var(--up)' }}
        />
      </div>

      {/* hero — plan progress leads, net worth is secondary */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
          gap: 28,
          padding: '30px 0 28px',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <div>
          <div className="lbl" style={{ marginBottom: 10 }}>
            Targets reached
          </div>
          <div className="hero acc">
            {summary.planProgress !== null ? `${Math.round(summary.planProgress * 100)}%` : '—'}
          </div>
          <div style={{ marginTop: 14, maxWidth: 260 }}>
            <Meter value={summary.planProgress ?? 0} />
          </div>
        </div>

        <div>
          <div className="lbl" style={{ marginBottom: 10 }}>
            Next exit
          </div>
          {summary.nearest ? (
            <>
              <div className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>
                {summary.nearest.symbol}{' '}
                <span className="acc">{summary.nearest.multiple}X</span>
              </div>
              <div className="num" style={{ marginTop: 8, fontSize: 15 }}>
                {formatPercent(summary.nearest.distance)} <span className="lbl">AWAY</span>
              </div>
            </>
          ) : (
            <div className="num dimmer" style={{ fontSize: 30 }}>—</div>
          )}
        </div>

        <div>
          <div className="lbl" style={{ marginBottom: 10 }}>
            Net worth
          </div>
          <div
            className="num"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', cursor: 'help' }}
            title={ethLabel(summary.value, ethPrice)}
          >
            {formatUsd(summary.value)}
          </div>
          {summary.pnl !== null && (
            <div
              className="num"
              style={{ marginTop: 8, fontSize: 15, color: summary.pnl >= 0 ? 'var(--up)' : 'var(--down)' }}
            >
              <span aria-hidden>{summary.pnl >= 0 ? '▲' : '▼'}</span> {formatUsd(summary.pnl)}
              {summary.pnlPct !== null && ` ${formatPercent(summary.pnlPct)}`}
            </div>
          )}
        </div>

        <div>
          <div className="lbl" style={{ marginBottom: 10 }}>
            Invested
          </div>
          <div
            className="num dim"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', cursor: 'help' }}
            title={ethLabel(summary.invested, ethPrice)}
          >
            {formatUsd(summary.invested)}
          </div>
          <div className="lbl" style={{ marginTop: 8 }}>
            COST OF HELD TOKENS
          </div>
        </div>

        <div>
          <div className="lbl" style={{ marginBottom: 10 }}>
            Realised
          </div>
          <div
            className="num"
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              color: summary.realized > 0 ? 'var(--up)' : summary.realized < 0 ? 'var(--down)' : 'var(--ink-3)',
              cursor: 'help',
            }}
            title={ethLabel(summary.realized || null, ethPrice)}
          >
            {summary.realized ? formatUsd(summary.realized) : '—'}
          </div>
          <div className="lbl" style={{ marginTop: 8 }}>
            BANKED FROM SALES
          </div>
        </div>
      </section>

      {/* scanner */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '14px 0',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <div style={{ display: 'flex', flex: 1, minWidth: 280, maxWidth: 440 }}>
          <input
            className="input"
            placeholder="0x… watch an address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setAddError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && addWallet()}
          />
          <button className="btn btn-solid" onClick={addWallet} disabled={adding} style={{ marginLeft: -1 }}>
            {adding ? '···' : 'Scan'}
          </button>
        </div>

        {/* Matches the scan control's height, and opens the manager so tokens
            can be added, removed, or the primary wallet switched. The active
            filter is shown here rather than hidden inside the modal. */}
        {wallets.map((w) => {
          const isPrimary = primaryWalletId === w.id
          return (
            <button
              key={w.id}
              className="btn"
              data-on={isPrimary}
              onClick={() => openPicker(w)}
              title={
                isPrimary
                  ? `Showing only ${w.address} — click to manage`
                  : `Manage tokens for ${w.address}`
              }
              style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}
            >
              {isPrimary && <span aria-hidden>●</span>}
              {shortAddress(w.address)}
              <span
                aria-hidden
                style={{
                  color: isPrimary ? 'var(--black)' : 'var(--accent)',
                  fontSize: 14,
                  lineHeight: 1,
                  fontWeight: 700,
                  marginTop: -1,
                }}
              >
                +
              </span>
            </button>
          )
        })}

        {primaryWalletId !== null && (
          <button className="btn btn-sm" onClick={() => setPrimaryWalletId(null)}>
            Show all
          </button>
        )}

        {notifyState === 'default' && (
          <button className="btn btn-sm" onClick={() => Notification.requestPermission().then(setNotifyState)}>
            Enable alerts
          </button>
        )}

        {addError && <span className="lbl down">{addError}</span>}
        {actionError && <span className="lbl down">{actionError}</span>}
        {unpriced > 0 && <span className="lbl">{unpriced} UNPRICED</span>}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '90px 20px', textAlign: 'center' }}>
          <div className="h1" style={{ marginBottom: 12 }}>
            NOTHING TRACKED
          </div>
          <p className="dim" style={{ fontSize: 13, maxWidth: 400, margin: '0 auto', lineHeight: 1.7 }}>
            Paste a wallet address above. Holdings on Ethereum and Robinhood Chain are read from
            public block explorers — nothing is signed and no keys are involved.
          </p>
        </div>
      ) : (
        /* Each coin owns its detail: clicking a row expands the ladder, the
           position and the chart nested beneath it, so there is no separate
           panel to keep mentally paired with a selection. */
        <section style={{ borderBottom: '1px solid var(--rule)' }}>
          {rows.map((r) => (
            <PositionRow
              key={r.id}
              row={r}
              expanded={r.id === selectedId}
              onToggle={() => setSelectedId(r.id === selectedId ? null : r.id)}
              onRemove={() => removeRow(r.id)}
            >
              {r.id === selectedId && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1.1fr) minmax(300px,0.9fr)',
                    gap: 14,
                    alignItems: 'start',
                  }}
                >
                  <ExitPlanner
                    row={r}
                    detail={detail}
                    onApply={applyTemplate}
                    onApplyCustom={applyCustom}
                    onRebase={rebaseLadder}
                    onClear={clearLadder}
                    onSetCost={setCost}
                  />
                  <div style={{ height: 500 }}>
                    <PriceChart row={r} detail={detail} />
                  </div>
                </div>
              )}
            </PositionRow>
          ))}
        </section>
      )}

      {picker && (
        <TokenPicker
          wallets={wallets}
          activeWalletId={picker.walletId}
          primaryWalletId={primaryWalletId}
          tokens={picker.tokens}
          trackedIds={trackedIds}
          loading={pickerLoading}
          onSwitchWallet={openPicker}
          onSetPrimary={setPrimaryWalletId}
          onRemoveWallet={removeWallet}
          onClose={() => setPicker(null)}
          onConfirm={(add, removeIds) => applyTokenChanges(picker.walletId, add, removeIds)}
        />
      )}

      <AlertToast
        alerts={alerts}
        onDismiss={(key) => setAlerts((prev) => prev.filter((a) => a.key !== key))}
      />
    </main>
  )
}
