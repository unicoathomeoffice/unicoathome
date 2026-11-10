import 'server-only'
import { HomecareRequest } from '../models'
import { getSettings } from '../settings'
import { googleBudget, recordUsage } from '../maps-usage'
import { haversine } from './tracking'

// Road route + ETA for a trip (Uber-style): the line along the streets from where the team is to where it is going,
// and the drive time. Google Routes API (traffic-aware) while its own monthly allowance lasts (Settings → Maps), then
// the free OSRM service, then a straight line × road factor. Cached on the request (tracking.route) and refreshed
// every 2 min, when the destination changes, or when the team has left the line by more than 150 m.

type Pt = { lat: number; lng: number }
export type RoadRoute = { points: [number, number][]; distanceM: number; durationS: number; provider: 'google' | 'osrm' | 'line'; at: string; from: Pt; to: Pt }

const REFRESH_MS = 2 * 60_000
const OFF_ROUTE_M = 150
const ROAD_FACTOR = 1.35
const CITY_KMH = 18

/** Google / OSRM encoded polyline (precision 5) → points. */
export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0
  let lat = 0
  let lng = 0
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0
      let result = 0
      let b: number
      do {
        b = s.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20 && i < s.length)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += d
      else lng += d
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

/** Metres from a point to the nearest vertex of the line (good enough at street scale). */
function offRoute(p: Pt, pts: [number, number][]) {
  let best = Infinity
  for (const [lat, lng] of pts) best = Math.min(best, haversine(p, { lat, lng }))
  return best
}

const origin = () => (process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://unico-homecare.vercel.app')).replace(/\/+$/, '')

async function google(from: Pt, to: Pt): Promise<Omit<RoadRoute, 'at' | 'from' | 'to'> | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return null
  const s = await getSettings()
  if (!(await googleBudget(s.maps)).kinds.routes?.ok) return null
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline', referer: `${origin()}/` },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'en',
        regionCode: 'BD',
      }),
    })
    await recordUsage('google', 'routes')
    if (!res.ok) return null
    const j: any = await res.json()
    const r = j.routes?.[0]
    if (!r?.polyline?.encodedPolyline) return null
    return { points: decodePolyline(r.polyline.encodedPolyline), distanceM: r.distanceMeters ?? 0, durationS: Number(String(r.duration ?? '0s').replace('s', '')) || 0, provider: 'google' }
  } catch {
    return null
  }
}

async function osrm(from: Pt, to: Pt): Promise<Omit<RoadRoute, 'at' | 'from' | 'to'> | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'UnicoHomeCare/1.0 (home care visit tracking)' } })
    if (!res.ok) return null
    const j: any = await res.json()
    const r = j.routes?.[0]
    if (!r?.geometry) return null
    await recordUsage('osm', 'osrm_route')
    // OSRM has no live traffic: Dhaka streets are slower than its free-flow estimate
    return { points: decodePolyline(r.geometry), distanceM: Math.round(r.distance ?? 0), durationS: Math.round((r.duration ?? 0) * 1.6), provider: 'osrm' }
  } catch {
    return null
  }
}

function line(from: Pt, to: Pt): Omit<RoadRoute, 'at' | 'from' | 'to'> {
  const m = haversine(from, to) * ROAD_FACTOR
  return { points: [[from.lat, from.lng], [to.lat, to.lng]], distanceM: Math.round(m), durationS: Math.round((m / 1000 / CITY_KMH) * 3600), provider: 'line' }
}

/** The trip's road route from `from` to `to`, re-using the cached one while it still fits. */
export async function roadRoute(r: any, from: Pt, to: Pt): Promise<RoadRoute> {
  const cached: RoadRoute | undefined = r.tracking?.route
  const fresh =
    cached &&
    cached.to &&
    haversine(cached.to, to) < 30 &&
    Date.now() - new Date(cached.at).getTime() < REFRESH_MS &&
    (cached.provider === 'line' ? haversine(cached.from, from) < 100 : offRoute(from, cached.points) < OFF_ROUTE_M)
  if (fresh) return trimTo(cached!, from)
  const got = (await google(from, to)) ?? (await osrm(from, to)) ?? line(from, to)
  const route: RoadRoute = { ...got, at: new Date().toISOString(), from, to }
  await HomecareRequest.updateOne({ _id: r._id }, { $set: { 'tracking.route': route } })
  return route
}

/** Cached route seen from where the team is now: drop the part already driven, scale distance and time. */
function trimTo(rt: RoadRoute, from: Pt): RoadRoute {
  if (rt.points.length < 3) return rt
  let idx = 0
  let best = Infinity
  rt.points.forEach(([lat, lng], i) => {
    const d = haversine(from, { lat, lng })
    if (d < best) (best = d), (idx = i)
  })
  const rest = rt.points.slice(idx)
  let left = haversine(from, { lat: rest[0][0], lng: rest[0][1] })
  for (let i = 1; i < rest.length; i++) left += haversine({ lat: rest[i - 1][0], lng: rest[i - 1][1] }, { lat: rest[i][0], lng: rest[i][1] })
  const share = rt.distanceM ? Math.min(1, left / rt.distanceM) : 1
  return { ...rt, points: [[from.lat, from.lng], ...rest], distanceM: Math.round(left), durationS: Math.round(rt.durationS * share) }
}
