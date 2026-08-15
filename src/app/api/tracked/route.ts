import { NextResponse } from 'next/server'
import { addTracked, listTracked, untrack, updateRule } from '@/lib/store'
import { isChainId } from '@/lib/chains'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const walletId = Number(new URL(req.url).searchParams.get('walletId'))
  return NextResponse.json({
    tracked: listTracked(Number.isFinite(walletId) && walletId > 0 ? walletId : undefined),
  })
}

interface TrackBody {
  walletId?: number
  chainId?: number
  tokenAddress?: string
  symbol?: string
  name?: string
  decimals?: number
  iconUrl?: string | null
  balanceRaw?: string | null
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as TrackBody | { tokens?: TrackBody[] }
  const items = 'tokens' in body && Array.isArray(body.tokens) ? body.tokens : [body as TrackBody]

  const added = []
  for (const item of items) {
    if (!item.walletId || !item.chainId || !item.tokenAddress) continue
    if (!isChainId(item.chainId)) continue
    added.push(
      addTracked({
        walletId: item.walletId,
        chainId: item.chainId,
        tokenAddress: item.tokenAddress,
        symbol: item.symbol,
        name: item.name,
        decimals: item.decimals,
        iconUrl: item.iconUrl,
        balanceRaw: item.balanceRaw,
      }),
    )
  }

  if (added.length === 0) {
    return NextResponse.json({ error: 'No valid tokens supplied' }, { status: 400 })
  }
  return NextResponse.json({ tracked: added })
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number
    metric?: 'price' | 'fdv'
    targetUp?: number | null
    stopDown?: number | null
  }

  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const row = updateRule(body.id, {
    metric: body.metric,
    targetUp: body.targetUp,
    stopDown: body.stopDown,
  })

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ tracked: row })
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  untrack(id)
  return NextResponse.json({ ok: true })
}
