import { NextResponse } from 'next/server'
import { clearTranches, getTracked, setTranches, setManualCost } from '@/lib/store'
import { TEMPLATES, type TemplateId } from '@/lib/templates'

export const dynamic = 'force-dynamic'

interface Body {
  trackedId?: number
  templateId?: TemplateId
  /** Custom ladder, used when no templateId is given. */
  tranches?: Array<{ multiple: number; pct: number }>
  /** Manual cost-basis override; null clears it back to the estimate. */
  avgCostManual?: number | null
}

/** Apply a template (or a custom ladder) to a position. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.trackedId) return NextResponse.json({ error: 'Missing trackedId' }, { status: 400 })

  const row = getTracked(body.trackedId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.avgCostManual !== undefined) {
    setManualCost(body.trackedId, body.avgCostManual)
  }

  const specs =
    body.templateId && TEMPLATES[body.templateId]
      ? TEMPLATES[body.templateId].tranches
      : (body.tranches ?? null)

  if (!specs || specs.length === 0) {
    return NextResponse.json({ tranches: [] })
  }

  const fresh = getTracked(body.trackedId)!
  // Prices are frozen at apply time so a later cost-basis refresh cannot
  // silently move a target the user already committed to.
  const base = fresh.avg_cost_manual ?? fresh.avg_cost ?? fresh.last_price ?? 0

  if (base <= 0) {
    return NextResponse.json(
      { error: 'No price or cost basis yet — cannot place a ladder.' },
      { status: 400 },
    )
  }

  // Freeze the position size along with the prices: tranche targets must stay
  // fixed as the plan executes, or selling would shrink every remaining target.
  const planBalance = fresh.balance_raw ? Number(fresh.balance_raw) / 10 ** fresh.decimals : null

  const tranches = setTranches(
    body.trackedId,
    specs.map((s) => ({ multiple: s.multiple, pct: s.pct, price: base * s.multiple })),
    body.templateId ?? null,
    planBalance,
  )

  return NextResponse.json({ tranches, base, planBalance })
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('trackedId'))
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Missing trackedId' }, { status: 400 })
  clearTranches(id)
  return NextResponse.json({ ok: true })
}
