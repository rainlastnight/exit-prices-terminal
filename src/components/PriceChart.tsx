'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type MouseEventParams,
} from 'lightweight-charts'
import type { Candle, PricedRow, PositionDetail } from '@/lib/types'
import { formatPrice, formatUsd, formatPercent } from '@/lib/format'
import { usePref } from '@/lib/usePref'

// "1m" rendered uppercase reads as one *month*, which is the opposite of a
// one-minute candle. Spelled out so the two controls can never be confused.
const TIMEFRAMES = [
  { id: 'minute', label: '1MIN' },
  { id: 'hour', label: '1H' },
  { id: 'day', label: '1D' },
] as const

type TfId = (typeof TIMEFRAMES)[number]['id']

/** How much history to show. Independent of the candle interval above. */
const RANGES = [
  { days: 1, label: '1D' },
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
] as const

/** Candles per day at each interval, used to size the fetch. */
const PER_DAY: Record<TfId, number> = { minute: 1440, hour: 24, day: 1 }

/** Above this many trades, markers show as arrows only — see the marker code. */
const LABEL_LIMIT = 6

interface Hover {
  price: number
  fdv: number | null
  time: number
  change: number | null
}

interface Props {
  row: PricedRow | null
  detail: PositionDetail | null
}

export function PriceChart({ row, detail }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const linesRef = useRef<IPriceLine[]>([])

  const [timeframe, setTimeframe] = usePref<TfId>('timeframe', 'hour')
  const [rangeDays, setRangeDays] = usePref<number>('rangeDays', 7)
  const [showTrades, setShowTrades] = usePref<boolean>('showTrades', true)
  const [candles, setCandles] = useState<Candle[]>([])
  /** True when the interval is too fine to cover the requested range. */
  const [clipped, setClipped] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [pool, setPool] = useState<{ address: string; liquidity: number | null } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  /* Supply drives the FDV readout: FDV = supply x price at the hovered candle. */
  const supply = row?.total_supply ? Number(row.total_supply) : null

  useEffect(() => {
    if (!boxRef.current) return

    // Chart chrome is matched to the design system: hard rules, mono labels,
    // black ground. Left to its defaults it reads as a soft widget dropped into
    // a hard-edged page.
    const chart = createChart(boxRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#525252',
        fontFamily: 'var(--font-mono), monospace',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#141414' },
      },
      rightPriceScale: {
        borderVisible: true,
        borderColor: '#262626',
        scaleMargins: { top: 0.16, bottom: 0.14 },
      },
      timeScale: {
        borderVisible: true,
        borderColor: '#262626',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#d6ff2e', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#d6ff2e' },
        horzLine: { color: '#d6ff2e', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#d6ff2e' },
      },
      autoSize: true,
    })

    const series = chart.addCandlestickSeries({
      upColor: '#14b8a6',
      downColor: '#e5484d',
      borderUpColor: '#14b8a6',
      borderDownColor: '#e5484d',
      wickUpColor: '#14b8a699',
      wickDownColor: '#e5484d99',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      linesRef.current = []
    }
  }, [])

  /* Crosshair readout. FDV leads, price follows. */
  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !param.point) return setHover(null)
      const bar = param.seriesData.get(series) as
        | { open: number; close: number }
        | undefined
      if (!bar) return setHover(null)

      setHover({
        price: bar.close,
        fdv: supply !== null ? supply * bar.close : null,
        time: Number(param.time),
        change: bar.open > 0 ? bar.close / bar.open - 1 : null,
      })
    }

    chart.subscribeCrosshairMove(onMove)
    return () => chart.unsubscribeCrosshairMove(onMove)
  }, [supply])

  /* Load candles. */
  useEffect(() => {
    if (!row) {
      setCandles([])
      setReason(null)
      return
    }
    let cancelled = false

    // Ask for just enough candles to cover the range at this interval, plus a
    // small margin. The route clamps to the provider's 1000-candle page.
    const want = Math.ceil(rangeDays * PER_DAY[timeframe] * 1.1) + 5

    fetch(`/api/candles?trackedId=${row.id}&timeframe=${timeframe}&limit=${want}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const all: Candle[] = d.candles ?? []
        const cutoff = Date.now() / 1000 - rangeDays * 86_400
        const inRange = all.filter((c) => c.time >= cutoff)

        // A thin token may have no candles at all inside a short window; show
        // what history exists rather than an empty chart.
        setCandles(inRange.length >= 2 ? inRange : all)

        // Only flag PARTIAL when the provider's page cap truncated us — e.g.
        // 30D of 1-minute candles. A token that is simply younger than the
        // range isn't partial data, it's all the data there is.
        const capped = d.limit != null && all.length >= d.limit
        setClipped(capped && all.length > 0 && all[0].time > cutoff)
        setReason(d.reason ?? null)
        setPool(d.poolAddress ? { address: d.poolAddress, liquidity: d.poolLiquidity } : null)
      })
      .catch(() => !cancelled && setCandles([]))

    return () => {
      cancelled = true
    }
  }, [row?.id, timeframe, rangeDays])

  /* Data, tranche lines and trade markers. */
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    series.setData(
      candles.map((c) => ({
        time: c.time as never,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

    for (const line of linesRef.current) series.removePriceLine(line)
    linesRef.current = []

    // Exit ladder: one line per tranche, labelled with its multiple and size.
    for (const t of row?.tranches ?? []) {
      linesRef.current.push(
        series.createPriceLine({
          price: t.price,
          color: t.fired ? '#14b8a6' : '#d6ff2e',
          lineWidth: 1,
          lineStyle: t.fired ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${t.multiple}X ${t.pct}%${t.fired ? ' ✓' : ''}`,
        }),
      )
    }

    // Cost basis — the line every multiple is measured from.
    if (detail?.pnl.avgCost) {
      linesRef.current.push(
        series.createPriceLine({
          price: detail.pnl.avgCost,
          color: '#8a8a8a',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'AVG. COST',
        }),
      )
    }

    // The wallet's own buys and sells, behind a toggle.
    //
    // Labels are selective, not universal: an active wallet can have dozens of
    // trades clustered in a few candles, and a price on every arrow collapses
    // into an unreadable stack. Past a handful, the arrows carry position and
    // direction and the crosshair supplies the price.
    const priced = (detail?.trades ?? []).filter((t) => t.price !== null)
    const labelled = priced.length <= LABEL_LIMIT

    const markers = showTrades
      ? priced
          .map((t) => ({
            time: t.ts as never,
            position: (t.kind === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            color: t.kind === 'buy' ? '#14b8a6' : '#e5484d',
            shape: (t.kind === 'buy' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            text: labelled ? `${t.kind === 'buy' ? 'B' : 'S'} ${formatPrice(t.price)}` : '',
          }))
          .sort((a, b) => Number(a.time) - Number(b.time))
      : []

    series.setMarkers(markers)

    chartRef.current?.timeScale().fitContent()
  }, [candles, row?.id, row?.tranches, detail, showTrades])

  const tradeCount = (detail?.trades ?? []).filter((t) => t.price !== null).length
  const empty = candles.length === 0
  const live = hover ?? {
    price: row?.price ?? 0,
    fdv: row?.fdv ?? null,
    time: 0,
    change: row?.change24h != null ? row.change24h / 100 : null,
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header style={{ padding: '16px 18px 12px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {row ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="h2">{row.symbol}</span>
                {hover && (
                  <span className="tag num">
                    {new Date(hover.time * 1000).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>

              {/* FDV leads the readout, price is secondary. */}
              <div className="num" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.05em' }}>
                {formatUsd(live.fdv)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
                <span className="lbl">FDV</span>
                <span className="num dim" style={{ fontSize: 13 }}>
                  {formatPrice(live.price)}
                </span>
                {live.change !== null && (
                  <span
                    className="num"
                    style={{ fontSize: 12, color: live.change >= 0 ? 'var(--up)' : 'var(--down)' }}
                  >
                    <span aria-hidden>{live.change >= 0 ? '▲' : '▼'}</span> {formatPercent(live.change)}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="lbl">Select a position</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {tradeCount > 0 && (
            <button
              className="btn btn-sm"
              data-on={showTrades}
              onClick={() => setShowTrades((v) => !v)}
              aria-pressed={showTrades}
              title={`${showTrades ? 'Hide' : 'Show'} your ${tradeCount} buy/sell marker${tradeCount === 1 ? '' : 's'}`}
            >
              <span aria-hidden>{showTrades ? '■' : '□'}</span> Trades {tradeCount}
            </button>
          )}

        </div>
      </header>

      <div style={{ position: 'relative', flex: 1, minHeight: 240 }}>
        <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />

        {empty && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}>
            <div style={{ textAlign: 'center', maxWidth: 300 }}>
              <div className="h2 dim" style={{ marginBottom: 8 }}>
                {reason === 'no-pool'
                  ? 'No DEX pool'
                  : reason === 'native-coin'
                    ? 'Native coin'
                    : row
                      ? 'No candle data'
                      : 'Nothing selected'}
              </div>
              <div className="lbl" style={{ textTransform: 'none', letterSpacing: 0, lineHeight: 1.6 }}>
                {reason === 'no-pool' && 'This token has no pool, so there is no history to chart.'}
                {reason === 'native-coin' && 'Native balances are priced but not charted.'}
              </div>
            </div>
          </div>
        )}
      </div>

      {row && (
        <footer
          style={{
            padding: '10px 18px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {pool && (
              <>
                <span className="lbl">Liquidity</span>
                <span
                  className="num"
                  style={{ fontSize: 12, color: (pool.liquidity ?? 0) < 1000 ? 'var(--down)' : 'var(--ink-2)' }}
                >
                  {formatUsd(pool.liquidity)}
                  {(pool.liquidity ?? 0) < 1000 && ' THIN'}
                </span>
              </>
            )}
            {tradeCount > 0 && showTrades && (
              <span className="lbl">
                <span aria-hidden className="up">▲</span>{' '}
                {detail!.trades.filter((t) => t.kind === 'buy').length} BUY{' '}
                <span aria-hidden className="down">▼</span>{' '}
                {detail!.trades.filter((t) => t.kind === 'sell').length} SELL
              </span>
            )}
          </div>

          {/* Interval and range sit together and share the same treatment, so
              the distinction between candle size and history depth is legible. */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {clipped && (
              <span
                className="lbl"
                style={{ color: 'var(--down)' }}
                title="Not enough candles at this interval to cover the range"
              >
                PARTIAL
              </span>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="lbl">Interval</span>
              <div className="seg">
                {TIMEFRAMES.map((tf) => (
                  <button key={tf.id} data-on={timeframe === tf.id} onClick={() => setTimeframe(tf.id)}>
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="lbl">Date range</span>
              <div className="seg">
                {RANGES.map((r) => (
                  <button key={r.days} data-on={rangeDays === r.days} onClick={() => setRangeDays(r.days)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
