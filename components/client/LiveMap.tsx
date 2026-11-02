'use client'
// Live tracking map (Leaflet + OpenStreetMap, no key): the travelling staff member, the trail so far, the
// destination (patient's door or the hospital) and an ETA chip. Polls the server every 10 s while a trip is active.
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { Clock3, MapPin, Navigation, Radio } from 'lucide-react'
import { api } from './api'
import { reportUsage } from './maps'
import { DHAKA } from '@/lib/maps'
import { cx } from '@/lib/format'

export type LivePoint = { lat: number; lng: number; accuracyM?: number | null; heading?: number | null }
export type LiveData = {
  active: boolean
  phase: 'OUT' | 'RETURN' | null
  at: string | null
  point: LivePoint | null
  dest: { lat: number; lng: number; label?: string } | null
  eta: { km: number; min: number } | null
  trail?: [number, number, number][]
}
export type LiveMarker = { id: string; label: string; sub?: string; point: LivePoint | null; phase: 'OUT' | 'RETURN' | null; at: string | null; dest?: { lat: number; lng: number } | null }

const TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
const ago = (iso: string | null, now: number) => {
  if (!iso) return 'no location yet'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  return s < 60 ? `updated ${s} s ago` : `updated ${Math.round(s / 60)} min ago`
}
const stale = (iso: string | null, now: number) => !iso || now - new Date(iso).getTime() > 3 * 60_000

function staffIcon(L: any, label: string, phase: string | null, heading: number | null | undefined, faded: boolean) {
  const bg = phase === 'RETURN' ? '#64748B' : '#0090CA'
  const arrow = heading != null && !Number.isNaN(heading) ? `<div style="position:absolute;left:50%;top:-9px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid ${bg};transform:translateX(-50%) rotate(${heading}deg);transform-origin:50% 27px"></div>` : ''
  return L.divIcon({
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="position:relative;width:36px;height:36px;opacity:${faded ? 0.5 : 1}">${arrow}<div style="width:36px;height:36px;border-radius:50%;background:${bg};color:#fff;font:700 12px/36px 'DM Sans',Arial,sans-serif;text-align:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.35)">${label.replace(/[<>&]/g, '')}</div></div>`,
  })
}
const destIcon = (L: any, kind: 'home' | 'hospital') =>
  L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    html: `<div style="width:28px;height:28px;background:${kind === 'hospital' ? '#1F3864' : '#DC2626'};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>`,
  })
const initials = (s: string) => s.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '•'

/** One request: polls /requests/:id/location (or a custom URL, e.g. the patient's public link). */
export function LiveMap({ url, initial, height = 320, staffName = 'Staff', poll = true, showTrail = true }: { url: string; initial?: LiveData | null; height?: number; staffName?: string; poll?: boolean; showTrail?: boolean }) {
  const [data, setData] = useState<LiveData | null>(initial ?? null)
  const [now, setNow] = useState(() => Date.now())
  const host = useRef<HTMLDivElement>(null)
  const L = useRef<any>(null)
  const map = useRef<any>(null)
  const layers = useRef<{ staff?: any; acc?: any; dest?: any; trail?: any }>({})
  const fitted = useRef(false)

  // parent-driven (poll off): follow the data it passes in
  useEffect(() => {
    if (!poll && initial) setData(initial)
  }, [poll, initial])

  useEffect(() => {
    if (!poll) return
    let live = true
    const load = () => api<LiveData>(url).then((d) => live && setData(d)).catch(() => {})
    if (!initial) load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 10_000)
    const tick = setInterval(() => setNow(Date.now()), 5_000)
    return () => {
      live = false
      clearInterval(id)
      clearInterval(tick)
    }
  }, [url, poll, initial])

  // create the map once
  useEffect(() => {
    let dead = false
    ;(async () => {
      const Lf = (await import('leaflet')).default
      if (dead || !host.current) return
      L.current = Lf
      map.current = Lf.map(host.current, { zoomControl: true, attributionControl: true }).setView(DHAKA, 12)
      Lf.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(map.current)
      reportUsage('osm', 'osm_map')
      setNow(Date.now()) // trigger a draw
    })()
    return () => {
      dead = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  // draw / update layers
  useEffect(() => {
    const Lf = L.current
    const m = map.current
    if (!Lf || !m || !data) return
    const ly = layers.current
    const faded = stale(data.at, now)
    if (data.dest) {
      const icon = destIcon(Lf, data.phase === 'RETURN' ? 'hospital' : 'home')
      if (!ly.dest) ly.dest = Lf.marker([data.dest.lat, data.dest.lng], { icon, title: data.phase === 'RETURN' ? 'Hospital' : 'Patient' }).addTo(m)
      else ly.dest.setLatLng([data.dest.lat, data.dest.lng]).setIcon(icon)
    }
    if (showTrail && data.trail?.length) {
      const pts = data.trail.map(([a, b]) => [a, b])
      if (!ly.trail) ly.trail = Lf.polyline(pts, { color: data.phase === 'RETURN' ? '#64748B' : '#0090CA', weight: 4, opacity: 0.7 }).addTo(m)
      else ly.trail.setLatLngs(pts)
    }
    if (data.point) {
      const p = [data.point.lat, data.point.lng]
      const icon = staffIcon(Lf, initials(staffName), data.phase, data.point.heading, faded)
      if (!ly.staff) ly.staff = Lf.marker(p, { icon, zIndexOffset: 1000, title: staffName }).addTo(m)
      else ly.staff.setLatLng(p).setIcon(icon)
      ly.acc?.remove()
      ly.acc = data.point.accuracyM ? Lf.circle(p, { radius: data.point.accuracyM, color: '#0090CA', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(m) : null
    }
    if (!fitted.current) {
      const pts: any[] = [data.point && [data.point.lat, data.point.lng], data.dest && [data.dest.lat, data.dest.lng], ...(data.trail ?? []).map(([a, b]) => [a, b])].filter(Boolean)
      if (pts.length > 1) m.fitBounds(pts, { padding: [40, 40], maxZoom: 16 })
      else if (pts.length === 1) m.setView(pts[0], 15)
      if (pts.length) fitted.current = true
    }
  }, [data, now, staffName, showTrail])

  const faded = data ? stale(data.at, now) : false
  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ height }}>
      <div ref={host} className="absolute inset-0 z-0" />
      {data && (
        <div className="pointer-events-none absolute left-2 top-2 z-[500] flex flex-wrap gap-1.5">
          {data.active ? (
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold shadow', faded ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-white text-[#15803D]')}>
              <Radio size={13} className={faded ? '' : 'animate-pulse'} /> {faded ? 'Signal lost · ' : 'Live · '}
              {ago(data.at, now)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-slate-600 shadow">Trip ended</span>
          )}
          {data.active && data.eta && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-navy px-2.5 py-1 text-[12px] font-bold text-white shadow">
              <Clock3 size={13} /> ≈ {data.eta.min} min · {data.eta.km} km {data.phase === 'RETURN' ? 'to hospital' : 'to patient'}
            </span>
          )}
        </div>
      )}
      {!data?.point && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] mx-auto w-fit rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 shadow">
          <Navigation size={13} className="mr-1 inline" /> Waiting for the first location…
        </div>
      )}
    </div>
  )
}

/** Many trips on one map (the /live page). Click a list row → focus. */
export function LiveBoardMap({ items, focus, height = 560 }: { items: LiveMarker[]; focus?: string | null; height?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const L = useRef<any>(null)
  const map = useRef<any>(null)
  const marks = useRef(new Map<string, any>())
  const [ready, setReady] = useState(false)
  const fitted = useRef(false)

  useEffect(() => {
    let dead = false
    ;(async () => {
      const Lf = (await import('leaflet')).default
      if (dead || !host.current) return
      L.current = Lf
      map.current = Lf.map(host.current).setView(DHAKA, 12)
      Lf.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(map.current)
      reportUsage('osm', 'osm_map')
      setReady(true)
    })()
    return () => {
      dead = true
      map.current?.remove()
    }
  }, [])

  useEffect(() => {
    const Lf = L.current
    const m = map.current
    if (!ready || !Lf || !m) return
    const now = Date.now()
    const seen = new Set<string>()
    for (const it of items) {
      if (!it.point) continue
      seen.add(it.id)
      const icon = staffIcon(Lf, initials(it.label), it.phase, it.point.heading, stale(it.at, now))
      const cur = marks.current.get(it.id)
      if (cur) cur.setLatLng([it.point.lat, it.point.lng]).setIcon(icon)
      else marks.current.set(it.id, Lf.marker([it.point.lat, it.point.lng], { icon, title: it.label }).bindTooltip(`${it.label}${it.sub ? ` · ${it.sub}` : ''}`).addTo(m))
    }
    for (const [id, mk] of marks.current) if (!seen.has(id)) (mk.remove(), marks.current.delete(id))
    if (!fitted.current && seen.size) {
      const pts = items.filter((i) => i.point).map((i) => [i.point!.lat, i.point!.lng])
      if (pts.length > 1) m.fitBounds(pts, { padding: [50, 50], maxZoom: 15 })
      else m.setView(pts[0], 14)
      fitted.current = true
    }
  }, [items, ready])

  useEffect(() => {
    const it = items.find((i) => i.id === focus)
    if (it?.point && map.current) map.current.setView([it.point.lat, it.point.lng], 16)
  }, [focus, items])

  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ height }}>
      <div ref={host} className="absolute inset-0 z-0" />
      {!items.length && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-[500] mx-auto w-fit rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 shadow">
          <MapPin size={14} className="mr-1 inline" /> Nobody is travelling right now
        </div>
      )}
    </div>
  )
}
