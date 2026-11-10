import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { GOOGLE_KINDS, googleBudget, probeGoogle } from '@/lib/maps-usage'

// May this page use Google Maps right now — and which Google APIs? Combines: admin switch, key present, each API's
// own monthly / daily allowance (Settings → Maps & API usage) and a shared check that Google accepts the key
// (lib/maps-usage.ts probeGoogle: kept 6 h when fine, re-checked after 15 min when refused).
export async function GET(req: NextRequest) {
  await db()
  const s = await getSettings()
  let budget = await googleBudget(s.maps)
  const usable = s.maps.useGoogle && !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && GOOGLE_KINDS.some((k) => budget.kinds[k].month < budget.kinds[k].monthlyCap && budget.kinds[k].today < budget.kinds[k].dailyCap)
  if (usable) {
    const before = budget.checkedAt
    const p = await probeGoogle(req.nextUrl.origin)
    if (new Date(p.at).toISOString() !== before) budget = await googleBudget(s.maps) // a fresh check: re-read the verdict
  }
  const kinds = Object.fromEntries(GOOGLE_KINDS.map((k) => [k, budget.kinds[k].ok]))
  return NextResponse.json({ google: budget.allowed, reason: budget.reason, kinds, remainingToday: budget.remainingToday, dailyCap: budget.dailyCap }, { headers: { 'cache-control': 'private, max-age=120' } })
}
