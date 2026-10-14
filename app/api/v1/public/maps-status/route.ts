import { NextResponse, type NextRequest } from 'next/server'

// Is Google Maps usable right now (key valid, APIs enabled, billing active)? Google's JS map shows its own
// "can't load Google Maps" dialog instead of failing detectably, so pages ask here first and use OpenStreetMap
// otherwise. One tiny Places call per instance every 6 h; the CDN caches the answer too.
let cached: { at: number; google: boolean } | null = null
const TTL = 6 * 3600_000

export async function GET(req: NextRequest) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return reply(false)
  if (!cached || Date.now() - cached.at > TTL) {
    let google = false
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key, referer: `${req.nextUrl.origin}/` }, // the key is restricted to this site
        body: JSON.stringify({ input: 'Dhaka', includedRegionCodes: ['bd'] }),
      })
      google = res.ok
    } catch {
      google = false
    }
    cached = { at: Date.now(), google }
  }
  return reply(cached.google)
}

const reply = (google: boolean) => NextResponse.json({ google }, { headers: { 'cache-control': 'public, max-age=600, s-maxage=21600, stale-while-revalidate=86400' } })
