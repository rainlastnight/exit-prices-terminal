import { NextResponse } from 'next/server'
import { addWallet, deleteWallet, listWallets } from '@/lib/store'
import { isValidAddress } from '@/lib/format'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ wallets: listWallets() })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; label?: string }
  const address = body.address?.trim() ?? ''

  if (!isValidAddress(address)) {
    return NextResponse.json({ error: 'Enter a valid 0x… address' }, { status: 400 })
  }

  return NextResponse.json({ wallet: addWallet(address, body.label) })
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }
  deleteWallet(id)
  return NextResponse.json({ ok: true })
}
