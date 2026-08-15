'use client'

import { useEffect } from 'react'
import { formatPrice, formatUsd } from '@/lib/format'

export interface FiredAlert {
  /**
   * Identity of the alert, not of the position. A single position can fire
   * several alerts at once — one per tranche rung — so keying on trackedId
   * collides and makes React drop toasts.
   */
  key: string
  trackedId: number
  symbol: string | null
  chainId: number
  direction: 'up' | 'down'
  metric: 'price' | 'fdv'
  threshold: number
  value: number
}

/** Semantic identity: same position, direction and threshold is the same alert. */
export const alertKey = (a: Omit<FiredAlert, 'key'>) =>
  `${a.trackedId}:${a.direction}:${a.threshold}`

interface Props {
  alerts: FiredAlert[]
  onDismiss: (key: string) => void
}

export function AlertToast({ alerts, onDismiss }: Props) {
  // Auto-dismiss so a long unattended session doesn't stack toasts forever.
  // Depend on the joined keys rather than the array identity, so a newly
  // arriving alert doesn't restart the countdown on the ones already showing.
  const keys = alerts.map((a) => a.key).join('|')

  useEffect(() => {
    if (alerts.length === 0) return
    const timers = alerts.map((a) => setTimeout(() => onDismiss(a.key), 20_000))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, onDismiss])

  if (alerts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 330,
      }}
      role="status"
      aria-live="polite"
    >
      {alerts.map((a) => {
        const up = a.direction === 'up'
        const color = up ? 'var(--up)' : 'var(--down)'
        const fmt = a.metric === 'fdv' ? formatUsd : formatPrice

        return (
          <div
            key={a.key}
            className="wipe"
            style={{
              background: 'var(--surface-2)',
              border: `1px solid ${color}`,
              borderLeftWidth: 3,
              padding: '11px 13px',
              boxShadow: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color, fontWeight: 600, fontSize: 12 }}>
                <span aria-hidden>{up ? '▲' : '▼'}</span> {a.symbol ?? 'Token'}{' '}
                {up ? 'hit target' : 'hit stop'}
              </span>
              <button
                onClick={() => onDismiss(a.key)}
                aria-label="Dismiss"
                style={{ background: 'none', border: 0, color: 'var(--ink-3)', cursor: 'pointer', font: 'inherit' }}
              >
                ✕
              </button>
            </div>
            <div className="num" style={{ fontSize: 11, color: 'var(--ink-2)', marginTop: 3 }}>
              {a.metric.toUpperCase()} {fmt(a.value)} {up ? '≥' : '≤'} {fmt(a.threshold)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
