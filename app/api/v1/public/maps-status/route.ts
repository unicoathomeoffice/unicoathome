import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { googleBudget } from '@/lib/maps-usage'

// May this page use Google Maps right now? Combines: admin switch, key present, today's / this month's
// budget (Settings → Maps & API usage) and a cached probe that the key actually works (billing active).
// Google's JS map shows its own "can't load" dialog instead of failing detectably, so pages ask here first
// and use OpenStreetMap otherwise. The probe is one tiny Places call per instance every 6 h.
let probe: { at: number; ok: boolean } | null = null
const TTL = 6 * 3600_000

export async function GET(req: NextRequest) {
  await db()
  const s = await getSettings()
  const budget = await googleBudget(s.maps)
  let reason: string = budget.reason
  let google = budget.allowed
  if (google) {
    if (!probe || Date.now() - probe.at > TTL) {
      let ok = false
      try {
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
          headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!, referer: `${req.nextUrl.origin}/` },
          body: JSON.stringify({ input: 'Dhaka', includedRegionCodes: ['bd'] }),
        })
        ok = res.ok
      } catch {
        ok = false
      }
      probe = { at: Date.now(), ok }
    }
    if (!probe.ok) (google = false), (reason = 'billing')
  }
  return NextResponse.json({ google, reason, remainingToday: budget.remainingToday, dailyCap: budget.dailyCap }, { headers: { 'cache-control': 'private, max-age=120' } })
}
