// Maps, free by default. Previews and routes = keyless Google embeds (no billing). Pin picker = OpenStreetMap
// (Leaflet), address search = Photon (OSM). Optional: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (browser key for Maps JavaScript
// API + Places API (New), 10,000 free calls/month each) switches search and the pin picker to Google — and they fall
// back to OpenStreetMap automatically whenever Google refuses (e.g. billing not active).

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

/** Dhaka city centre — default centre for the pin picker and search bias. */
export const DHAKA = { lat: 23.8103, lng: 90.4125 }

export type Place = { lat?: number | null; lng?: number | null; address?: string | null }
const hasPoint = (p: Place) => p.lat != null && p.lng != null

/** Google Maps turn-by-turn directions to a place (opens the app on phones). */
export function directionsUrl(p: Place) {
  const d = hasPoint(p) ? `${p.lat},${p.lng}` : `${p.address ?? ''}, Dhaka`
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d)}&travelmode=driving`
}

/** URL for an <iframe> map of one place (pin on coordinates when known, else the address). Keyless Google embed:
 *  free and needs no billing, so previews keep working whatever state the Google Cloud project is in. */
export function embedUrl(p: Place, zoom = 16) {
  const q = hasPoint(p) ? `${p.lat},${p.lng}` : `${p.address ?? ''}, Dhaka, Bangladesh`
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${zoom}&output=embed`
}

/** Embedded driving route through several stops (keyless Google embed, up to ~20 stops). */
export function embedRouteUrl(stops: Place[]) {
  if (stops.length < 2) return null
  const s = stops.slice(0, 20).map((p) => encodeURIComponent(hasPoint(p) ? `${p.lat},${p.lng}` : `${p.address ?? ''}, Dhaka`))
  return `https://maps.google.com/maps?saddr=${s[0]}&daddr=${s.slice(1).join('+to:')}&dirflg=d&output=embed`
}
