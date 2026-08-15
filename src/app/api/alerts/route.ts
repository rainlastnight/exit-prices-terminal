import { NextResponse } from 'next/server'
import { listAlerts, markAlertsSeen } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ alerts: listAlerts() })
}

export async function POST() {
  markAlertsSeen()
  return NextResponse.json({ ok: true })
}
