'use client'
// The two map engines behind the live tracking maps (LiveMap / LiveBoardMap): Google Maps JS while Google is allowed
// (key accepted and this month's map-load allowance left — components/client/maps.tsx), otherwise Leaflet with free
// OpenStreetMap tiles. Same small API for both, so the maps don't care which one is drawing.
// Marker HTML is built by the maps from escaped initials / fixed SVG only — never from user text.
import { DHAKA } from '@/lib/maps'
import { dropGoogle, googleUsable, loadGoogleMaps, reportUsage, MAP_ID } from './maps'

export type Pt = { lat: number; lng: number }
export type MarkerOpts = { title?: string; z?: number; anchor?: 'center' | 'bottom'; tooltip?: string; size?: number; onClick?: () => void }
export type LiveEngine = {
  kind: 'google' | 'osm'
  /** an HTML marker (staff bubble / destination pin), created or redrawn */
  marker: (id: string, p: Pt, html: string, o?: MarkerOpts) => void
  /** move a marker only (cheap — used every animation frame) */
  move: (id: string, p: Pt) => void
  removeMarker: (id: string) => void
  markerIds: () => string[]
  /** a named polyline (trail travelled, road ahead…); empty points remove it */
  line: (id: string, pts: Pt[], color: string, o?: { dashed?: boolean; width?: number; opacity?: number }) => void
  circle: (p: Pt | null, radiusM?: number | null) => void
  fit: (pts: Pt[], maxZoom: number, padding: number) => void
  view: (p: Pt, zoom: number) => void
  /** keep the camera on a point without changing the zoom (follow mode) */
  pan: (p: Pt) => void
  /** the user dragged / zoomed the map (follow mode turns off) */
  onUserMove: (fn: () => void) => void
  destroy: () => void
}

const TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
const el = (html: string) => {
  const d = document.createElement('div')
  d.innerHTML = html
  return d
}

/** Google when allowed (falls back to Leaflet if it refuses), else Leaflet. One map load is reported per page. */
export async function createLiveEngine(host: HTMLElement, sizePx = 36): Promise<LiveEngine> {
  if (await googleUsable('maps_js')) {
    try {
      return await googleEngine(host, sizePx)
    } catch {
      dropGoogle()
    }
  }
  return leafletEngine(host, sizePx)
}

async function googleEngine(host: HTMLElement, sizePx: number): Promise<LiveEngine> {
  const maps = await loadGoogleMaps()
  const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')])
  const box = document.createElement('div')
  box.style.cssText = 'width:100%;height:100%'
  host.replaceChildren(box)
  const map = new Map(box, { center: DHAKA, zoom: 12, mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: 'greedy', clickableIcons: false })
  reportUsage('google', 'maps_js')
  const marks = new globalThis.Map<string, any>()
  const lines = new globalThis.Map<string, any>()
  let circ: any = null
  let moved: (() => void) | null = null
  map.addListener('dragstart', () => moved?.())
  return {
    kind: 'google',
    marker: (id, p, html, o = {}) => {
      const content = el(html)
      // AdvancedMarker anchors at the bottom centre: lift round bubbles so their centre sits on the point
      if (o.anchor !== 'bottom') content.style.transform = `translateY(${(o.size ?? sizePx) / 2}px)`
      const cur = marks.get(id)
      if (cur) {
        cur.position = p
        cur.content = content
        cur.title = o.tooltip ?? o.title ?? ''
      } else {
        const m = new AdvancedMarkerElement({ map, position: p, content, title: o.tooltip ?? o.title ?? '', zIndex: o.z ?? 0 })
        if (o.onClick) m.addListener('click', o.onClick)
        marks.set(id, m)
      }
    },
    move: (id, p) => {
      const m = marks.get(id)
      if (m) m.position = p
    },
    removeMarker: (id) => {
      const m = marks.get(id)
      if (m) m.map = null
      marks.delete(id)
    },
    markerIds: () => [...marks.keys()],
    line: (id, pts, color, o = {}) => {
      const cur = lines.get(id)
      if (!pts.length) {
        cur?.setMap(null)
        lines.delete(id)
        return
      }
      const style = o.dashed
        ? { strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: o.opacity ?? 0.9, strokeColor: color, scale: 3 }, offset: '0', repeat: '12px' }] }
        : { strokeOpacity: o.opacity ?? 0.8, strokeColor: color, strokeWeight: o.width ?? 4, icons: [] }
      if (cur) cur.setOptions({ path: pts, ...style })
      else lines.set(id, new maps.Polyline({ map, path: pts, clickable: false, ...style }))
    },
    circle: (p, r) => {
      circ?.setMap(null)
      circ = p && r ? new maps.Circle({ map, center: p, radius: r, strokeColor: '#0090CA', strokeWeight: 1, fillColor: '#0090CA', fillOpacity: 0.1, clickable: false }) : null
    },
    fit: (pts, maxZoom, padding) => {
      if (pts.length === 1) return (map.setCenter(pts[0]), map.setZoom(Math.min(15, maxZoom)))
      const b = new maps.LatLngBounds()
      pts.forEach((p) => b.extend(p))
      map.fitBounds(b, padding)
      maps.event.addListenerOnce(map, 'idle', () => map.getZoom() > maxZoom && map.setZoom(maxZoom))
    },
    view: (p, zoom) => (map.setCenter(p), map.setZoom(zoom)),
    pan: (p) => map.panTo(p),
    onUserMove: (fn) => (moved = fn),
    destroy: () => {
      marks.forEach((m) => (m.map = null))
      lines.forEach((l) => l.setMap(null))
      host.replaceChildren()
    },
  }
}

async function leafletEngine(host: HTMLElement, sizePx: number): Promise<LiveEngine> {
  const L = (await import('leaflet')).default
  const box = document.createElement('div')
  box.style.cssText = 'width:100%;height:100%'
  host.replaceChildren(box)
  const map = L.map(box, { zoomControl: true, attributionControl: true }).setView([DHAKA.lat, DHAKA.lng], 12)
  L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(map)
  reportUsage('osm', 'osm_map')
  const marks = new Map<string, any>()
  const lines = new Map<string, any>()
  let circ: any = null
  let moved: (() => void) | null = null
  map.on('dragstart', () => moved?.())
  const icon = (html: string, o: MarkerOpts = {}) => {
    const s = o.size ?? sizePx
    return L.divIcon({ className: '', html, iconSize: [s, s], iconAnchor: o.anchor === 'bottom' ? [s / 2, s] : [s / 2, s / 2] })
  }
  return {
    kind: 'osm',
    marker: (id, p, html, o = {}) => {
      const cur = marks.get(id)
      if (cur) cur.setLatLng([p.lat, p.lng]).setIcon(icon(html, o))
      else {
        const m = L.marker([p.lat, p.lng], { icon: icon(html, o), title: o.title, zIndexOffset: o.z ?? 0 }).addTo(map)
        if (o.tooltip) m.bindTooltip(o.tooltip)
        if (o.onClick) m.on('click', o.onClick)
        marks.set(id, m)
      }
    },
    move: (id, p) => marks.get(id)?.setLatLng([p.lat, p.lng]),
    removeMarker: (id) => {
      marks.get(id)?.remove()
      marks.delete(id)
    },
    markerIds: () => [...marks.keys()],
    line: (id, pts, color, o = {}) => {
      const cur = lines.get(id)
      if (!pts.length) {
        cur?.remove()
        lines.delete(id)
        return
      }
      const ll = pts.map((p) => [p.lat, p.lng] as [number, number])
      const style = { color, weight: o.width ?? (o.dashed ? 3 : 4), opacity: o.opacity ?? 0.8, dashArray: o.dashed ? '6 8' : undefined }
      if (cur) cur.setLatLngs(ll).setStyle(style)
      else lines.set(id, L.polyline(ll, { ...style, interactive: false }).addTo(map))
    },
    circle: (p, r) => {
      circ?.remove()
      circ = p && r ? L.circle([p.lat, p.lng], { radius: r, color: '#0090CA', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map) : null
    },
    fit: (pts, maxZoom, padding) => {
      if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], Math.min(15, maxZoom))
      else map.fitBounds(pts.map((p) => [p.lat, p.lng] as [number, number]), { padding: [padding, padding], maxZoom })
    },
    view: (p, zoom) => map.setView([p.lat, p.lng], zoom),
    pan: (p) => map.panTo([p.lat, p.lng], { animate: true }),
    onUserMove: (fn) => (moved = fn),
    destroy: () => map.remove(),
  }
}
