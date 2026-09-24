// Approximate geography for Dhaka zones — no maps API. Used for map pins, distances and drive-time estimates.

/** Rough centre of each service zone (lat, lng) */
export const ZONE_LL: Record<string, [number, number]> = {
  Dhanmondi: [23.7465, 90.376],
  Lalmatia: [23.7545, 90.3685],
  Mohammadpur: [23.7662, 90.3589],
  Uttara: [23.8759, 90.3795],
  Mirpur: [23.8223, 90.3654],
  Gulshan: [23.7925, 90.4078],
  Banani: [23.794, 90.4043],
  Motijheel: [23.733, 90.4172],
  Savar: [23.8583, 90.2667],
  Bashundhara: [23.8193, 90.4526],
  Badda: [23.7806, 90.4265],
}
/** Unico Hospitals (trip start / end) — approximate */
export const HOSPITAL_LL: [number, number] = [23.7509, 90.3935]

export function pointOf(area?: string | null, lat?: number | null, lng?: number | null): [number, number] {
  if (lat != null && lng != null) return [lat, lng]
  const key = Object.keys(ZONE_LL).find((z) => (area ?? '').toLowerCase().includes(z.toLowerCase()))
  return key ? ZONE_LL[key] : HOSPITAL_LL
}

/** Straight-line km × road factor */
export function roadKm(a: [number, number], b: [number, number]) {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.35
  return Math.max(0.8, Math.round(km * 10) / 10)
}

/** City traffic estimate (~18 km/h average, 10 min minimum) */
export const driveMin = (km: number) => Math.max(10, Math.round((km / 18) * 60 / 5) * 5)

/** Project points into a box as percentages (x = lng, y = lat, north up) with padding. */
export function project(points: [number, number][], pad = 14) {
  if (!points.length) return []
  const lats = points.map((p) => p[0])
  const lngs = points.map((p) => p[1])
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.01)
  const cLat = (minLat + maxLat) / 2
  const cLng = (minLng + maxLng) / 2
  const seen = new Map<string, number>()
  return points.map(([la, ln]) => {
    const key = `${la.toFixed(3)},${ln.toFixed(3)}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    // stops in the same zone fan out so their pins stay readable
    return {
      x: Math.min(94, 50 + ((ln - cLng) / span) * (100 - pad * 2) + n * 7),
      y: Math.max(12, 50 - ((la - cLat) / span) * (100 - pad * 2) + 8 - n * 4),
    }
  })
}

export function directionsUrl(stops: { address?: string; lat?: number; lng?: number }[]) {
  const s = (x: { address?: string; lat?: number; lng?: number }) => (x.lat != null && x.lng != null ? `${x.lat},${x.lng}` : `${x.address ?? ''}, Dhaka`)
  if (!stops.length) return 'https://www.google.com/maps'
  const dest = stops[stops.length - 1]
  const way = stops.slice(0, -1).map(s).join('|')
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(s(dest))}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}`
}
