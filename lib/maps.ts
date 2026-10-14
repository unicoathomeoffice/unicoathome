// Maps, free by default. No key needed: pin picker = OpenStreetMap (Leaflet), address search = Photon (OSM),
// map previews = keyless Google embed. Optional upgrade: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (a Google Cloud browser
// key restricted to this site and to Maps Embed API (free, unlimited), Maps JavaScript API and Places API (New),
// 10,000 free calls a month each) and search, pin picker and the route map switch to Google.

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

/** Dhaka city centre — default centre for the pin picker and search bias. */
export const DHAKA = { lat: 23.8103, lng: 90.4125 }

export type Place = { lat?: number | null; lng?: number | null; address?: string | null }
const hasPoint = (p: Place) => p.lat != null && p.lng != null

/** URL for an <iframe> map of one place (pin on coordinates when known, else the address). */
export function embedUrl(p: Place, zoom = 16) {
  const q = hasPoint(p) ? `${p.lat},${p.lng}` : `${p.address ?? ''}, Dhaka, Bangladesh`
  return MAPS_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${encodeURIComponent(q)}&zoom=${zoom}`
    : `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${zoom}&output=embed`
}

/** Embedded driving route through several stops (needs the key — returns null without one). */
export function embedRouteUrl(stops: Place[]) {
  if (!MAPS_KEY || stops.length < 2) return null
  const s = stops.map((p) => (hasPoint(p) ? `${p.lat},${p.lng}` : `${p.address ?? ''}, Dhaka`))
  const mid = s.slice(1, -1).slice(0, 20).map(encodeURIComponent).join('|')
  return `https://www.google.com/maps/embed/v1/directions?key=${MAPS_KEY}&mode=driving&origin=${encodeURIComponent(s[0])}&destination=${encodeURIComponent(s[s.length - 1])}${mid ? `&waypoints=${mid}` : ''}`
}
