'use client'
// Live tracking map, Uber-style: the travelling staff member glides along between updates and turns with the road,
// the road ahead to the destination is drawn with a live ETA, and the camera can follow the team. Google Maps while
// Google is allowed, otherwise free OpenStreetMap (./live-engines.ts). Polls every 5 s while a trip is active.
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { Clock3, Crosshair, LocateFixed, MapPin, Navigation, PauseCircle, Radio } from 'lucide-react'
import { api } from './api'
import { createLiveEngine, type LiveEngine, type Pt } from './live-engines'
import { cx } from '@/lib/format'

export type LivePoint = { lat: number; lng: number; accuracyM?: number | null; heading?: number | null }
export type LiveData = {
  active: boolean
  phase: 'OUT' | 'RETURN' | null
  at: string | null
  /** the phone's app left the screen after its last point (locked / another app opened) */
  pausedAt?: string | null
  point: LivePoint | null
  dest: { lat: number; lng: number; label?: string } | null
  eta: { km: number; min: number; source?: string } | null
  /** road ahead to the destination */
  route?: [number, number][] | null
  speedKmh?: number | null
  trail?: [number, number, number][]
}
export type LiveState = 'live' | 'paused' | 'lost' | 'return'
export type LiveMarker = { id: string; label: string; sub?: string; point: LivePoint | null; phase: 'OUT' | 'RETURN' | null; at: string | null; dest?: { lat: number; lng: number } | null; state?: LiveState }

const POLL_MS = 5_000
const ago = (iso: string | null, now: number) => {
  if (!iso) return 'no location yet'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  return s < 60 ? `updated ${s} s ago` : `updated ${Math.round(s / 60)} min ago`
}
const stale = (iso: string | null, now: number) => !iso || now - new Date(iso).getTime() > 3 * 60_000
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
const initials = (s: string) => s.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '•'
const COLOR: Record<LiveState, string> = { live: '#0090CA', paused: '#F59E0B', lost: '#DC2626', return: '#64748B' }

/** compass bearing a → b in degrees */
function bearing(a: Pt, b: Pt) {
  const t = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(t(b.lng - a.lng)) * Math.cos(t(b.lat))
  const x = Math.cos(t(a.lat)) * Math.sin(t(b.lat)) - Math.sin(t(a.lat)) * Math.cos(t(b.lat)) * Math.cos(t(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// marker HTML: only escaped initials go in, nothing from users
function staffHtml(label: string, color: string, heading: number | null | undefined, faded: boolean) {
  const arrow =
    heading != null && !Number.isNaN(heading)
      ? `<div style="position:absolute;inset:-12px;transform:rotate(${Math.round(heading)}deg);transition:transform .8s linear"><div style="position:absolute;left:50%;top:0;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:13px solid ${color};transform:translateX(-50%)"></div></div>`
      : ''
  return `<div style="position:relative;width:40px;height:40px;opacity:${faded ? 0.55 : 1}">${arrow}<div style="position:absolute;inset:-6px;border-radius:50%;background:${color};opacity:.18"></div><div style="position:relative;width:40px;height:40px;border-radius:50%;background:${color};color:#fff;font:700 13px/40px 'DM Sans',Arial,sans-serif;text-align:center;border:3px solid #fff;box-shadow:0 3px 10px rgba(15,23,42,.35)">${label.replace(/[<>&"']/g, '')}</div></div>`
}
const destHtml = (kind: 'home' | 'hospital') =>
  `<div style="width:30px;height:30px;margin:3px;background:${kind === 'hospital' ? '#1F3864' : '#DC2626'};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>`

/** One map engine per mount (Google or OpenStreetMap), destroyed on unmount. */
function useEngine(host: React.RefObject<HTMLDivElement | null>) {
  const [engine, setEngine] = useState<LiveEngine | null>(null)
  useEffect(() => {
    let dead = false
    let e: LiveEngine | null = null
    if (host.current)
      createLiveEngine(host.current).then((x) => {
        if (dead) return x.destroy()
        e = x
        setEngine(x)
      })
    return () => {
      dead = true
      e?.destroy()
    }
  }, [host])
  return engine
}

/** Glide markers between updates (requestAnimationFrame), so the team moves smoothly like a ride-hailing car. */
function useGlide(engine: LiveEngine | null) {
  const pos = useRef(new Map<string, Pt>())
  const anim = useRef(new Map<string, number>())
  useEffect(() => () => anim.current.forEach((h) => cancelAnimationFrame(h)), [])
  return {
    /** current on-screen position of a marker */
    at: (id: string) => pos.current.get(id),
    /** animate marker `id` to `to` over `ms` (first time: jump) */
    to: (id: string, to: Pt, ms = POLL_MS, onFrame?: (p: Pt) => void) => {
      if (!engine) return
      const from = pos.current.get(id)
      const prev = anim.current.get(id)
      if (prev) cancelAnimationFrame(prev)
      if (!from || (Math.abs(from.lat - to.lat) < 1e-7 && Math.abs(from.lng - to.lng) < 1e-7)) {
        pos.current.set(id, to)
        engine.move(id, to)
        onFrame?.(to)
        return
      }
      const start = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / ms)
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2 // ease in-out
        const p = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e }
        pos.current.set(id, p)
        engine.move(id, p)
        onFrame?.(p)
        if (k < 1) anim.current.set(id, requestAnimationFrame(step))
        else anim.current.delete(id)
      }
      anim.current.set(id, requestAnimationFrame(step))
    },
    forget: (id: string) => pos.current.delete(id),
  }
}

/** One request: polls /requests/:id/location (or a custom URL, e.g. the patient's public link). */
export function LiveMap({
  url,
  initial,
  height = 320,
  staffName = 'Staff',
  poll = true,
  showTrail = true,
  follow: followInitially = false,
  pollMs = POLL_MS,
}: {
  url: string
  initial?: LiveData | null
  height?: number | string
  staffName?: string
  poll?: boolean
  showTrail?: boolean
  /** start with the camera following the team (patient page) */
  follow?: boolean
  pollMs?: number
}) {
  const [data, setData] = useState<LiveData | null>(initial ?? null)
  const [now, setNow] = useState(() => Date.now())
  const [follow, setFollow] = useState(followInitially)
  const host = useRef<HTMLDivElement>(null)
  const engine = useEngine(host)
  const glide = useGlide(engine)
  const fitted = useRef(false)
  const headingRef = useRef<number | null>(null)
  const followRef = useRef(follow)
  followRef.current = follow

  // parent-driven (poll off): follow the data it passes in
  useEffect(() => {
    if (!poll && initial) setData(initial)
  }, [poll, initial])

  // the "updated N s ago" clock ticks either way
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (!poll) return
    let live = true
    const load = () => api<LiveData>(url).then((d) => live && setData(d)).catch(() => {})
    if (!initial) load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, pollMs)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [url, poll, initial, pollMs])

  useEffect(() => engine?.onUserMove(() => setFollow(false)), [engine])

  // draw / update
  useEffect(() => {
    const e = engine
    if (!e || !data) return
    const faded = stale(data.at, now)
    const paused = faded && !!data.pausedAt
    const color = data.phase === 'RETURN' ? COLOR.return : paused ? COLOR.paused : faded ? COLOR.lost : COLOR.live
    if (data.dest) e.marker('dest', data.dest, destHtml(data.phase === 'RETURN' ? 'hospital' : 'home'), { title: data.phase === 'RETURN' ? 'Hospital' : 'Patient', anchor: 'bottom', size: 36 })
    if (showTrail && data.trail?.length) e.line('trail', data.trail.map(([lat, lng]) => ({ lat, lng })), '#94A3B8', { width: 4, opacity: 0.7 })
    // the road ahead (Uber-style): from the team to the door
    e.line('ahead', data.active && data.route?.length ? data.route.map(([lat, lng]) => ({ lat, lng })) : [], color, { width: 5, opacity: 0.85 })
    if (data.point) {
      const prev = glide.at('staff')
      const heading = data.point.heading ?? (prev ? bearing(prev, data.point) : headingRef.current)
      if (heading != null) headingRef.current = heading
      e.marker('staff', prev ?? data.point, staffHtml(initials(staffName), color, headingRef.current, faded), { title: staffName, z: 1000, size: 40 })
      glide.to('staff', data.point, pollMs, (p) => followRef.current && e.pan(p))
      e.circle(data.point.accuracyM && data.point.accuracyM > 30 ? data.point : null, data.point.accuracyM)
    }
    if (!fitted.current) {
      const pts: Pt[] = [data.point, data.dest, ...(data.route ?? []).map(([lat, lng]) => ({ lat, lng })), ...(data.trail ?? []).map(([lat, lng]) => ({ lat, lng }))].filter((p): p is Pt => !!p)
      if (pts.length) {
        if (followInitially && data.point) e.view(data.point, 16)
        else e.fit(pts, 16, 50)
        fitted.current = true
      }
    }
    // data changes only (not the 5 s clock): the glide handles motion in between
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, data, staffName, showTrail])

  const faded = data ? stale(data.at, now) : false
  const paused = faded && !!data?.pausedAt
  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ height }}>
      <div ref={host} className="absolute inset-0 z-0" />
      {data && (
        <div className="pointer-events-none absolute left-2 top-2 z-[500] flex flex-wrap gap-1.5">
          {data.active ? (
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold shadow', paused ? 'bg-[#FEF3C7] text-[#B45309]' : faded ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-white text-[#15803D]')}>
              {paused ? <PauseCircle size={13} /> : <Radio size={13} className={faded ? '' : 'animate-pulse'} />}
              {paused ? `Paused · ${staffName.split(' ')[0]} left the app at ${clock(data.pausedAt!)}` : `${faded ? 'Signal lost · ' : 'Live · '}${ago(data.at, now)}`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-slate-600 shadow">Trip ended</span>
          )}
          {data.active && data.eta && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-navy px-2.5 py-1 text-[12px] font-bold text-white shadow">
              <Clock3 size={13} /> ≈ {data.eta.min} min · {data.eta.km} km {data.phase === 'RETURN' ? 'to hospital' : 'to patient'}
            </span>
          )}
          {data.active && data.speedKmh != null && data.speedKmh > 3 && !faded && <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-slate-600 shadow">{data.speedKmh} km/h</span>}
        </div>
      )}
      {data?.active && data.point && (
        <button
          type="button"
          onClick={() => {
            setFollow((f) => !f)
            const p = glide.at('staff') ?? data.point
            if (p && engine) engine.view(p, 16)
          }}
          className={cx('absolute bottom-3 right-3 z-[500] inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold shadow-lg', follow ? 'bg-primary text-white' : 'bg-white text-slate-700')}
          aria-pressed={follow}
        >
          {follow ? <LocateFixed size={16} /> : <Crosshair size={16} />} {follow ? 'Following' : 'Follow'}
        </button>
      )}
      {!data?.point && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] mx-auto w-fit rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 shadow">
          <Navigation size={13} className="mr-1 inline" /> Waiting for the first location…
        </div>
      )}
    </div>
  )
}

/** Many trips on one map (the /live page): gliding markers coloured by state; the focused team's road ahead + follow. */
export function LiveBoardMap({ items, focus, height = 560, onSelect }: { items: LiveMarker[]; focus?: string | null; height?: number; onSelect?: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useEngine(host)
  const glide = useGlide(engine)
  const fitted = useRef(false)
  const focusRef = useRef(focus)
  focusRef.current = focus
  const [detail, setDetail] = useState<LiveData | null>(null)

  useEffect(() => {
    const e = engine
    if (!e) return
    const now = Date.now()
    const seen = new Set<string>()
    for (const it of items) {
      if (!it.point) continue
      seen.add(it.id)
      const state: LiveState = it.state ?? (it.phase === 'RETURN' ? 'return' : stale(it.at, now) ? 'lost' : 'live')
      const prev = glide.at(it.id)
      const heading = it.point.heading ?? (prev ? bearing(prev, it.point) : null)
      e.marker(it.id, prev ?? it.point, staffHtml(initials(it.label), COLOR[state], heading, state === 'lost'), { title: it.label, tooltip: `${it.label}${it.sub ? ` · ${it.sub}` : ''}`, size: 40, z: it.id === focusRef.current ? 1000 : 0, onClick: onSelect ? () => onSelect(it.id) : undefined })
      glide.to(it.id, it.point, POLL_MS * 2, (p) => it.id === focusRef.current && e.pan(p))
    }
    for (const id of e.markerIds()) if (!seen.has(id) && id !== 'dest') (e.removeMarker(id), glide.forget(id))
    if (!fitted.current && seen.size) {
      e.fit(
        items.filter((i) => i.point).map((i) => i.point!),
        15,
        50,
      )
      fitted.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, engine])

  // the focused team: zoom in, show its road ahead + destination, and keep following
  useEffect(() => {
    const e = engine
    if (!e) return
    if (!focus) {
      e.line('ahead', [], '#0090CA')
      e.removeMarker('dest')
      setDetail(null)
      return
    }
    const it = items.find((i) => i.id === focus)
    if (it?.point) e.view(glide.at(focus) ?? it.point, 16)
    let live = true
    const load = () =>
      api<LiveData>(`/requests/${focus}/location`)
        .then((d) => {
          if (!live) return
          setDetail(d)
          e.line('ahead', d.active && d.route?.length ? d.route.map(([lat, lng]) => ({ lat, lng })) : [], d.phase === 'RETURN' ? COLOR.return : COLOR.live, { width: 5, opacity: 0.85 })
          if (d.dest) e.marker('dest', d.dest, destHtml(d.phase === 'RETURN' ? 'hospital' : 'home'), { anchor: 'bottom', size: 36, title: d.phase === 'RETURN' ? 'Hospital' : 'Patient' })
        })
        .catch(() => {})
    load()
    const id = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS)
    return () => {
      live = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, engine])

  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ height }}>
      <div ref={host} className="absolute inset-0 z-0" />
      {!items.length && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-[500] mx-auto w-fit rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 shadow">
          <MapPin size={14} className="mr-1 inline" /> Nobody is travelling right now
        </div>
      )}
      {focus && detail?.eta && detail.active && (
        <div className="pointer-events-none absolute left-2 top-2 z-[500] inline-flex items-center gap-1.5 rounded-full bg-navy px-2.5 py-1 text-[12px] font-bold text-white shadow">
          <Clock3 size={13} /> ≈ {detail.eta.min} min · {detail.eta.km} km {detail.phase === 'RETURN' ? 'to hospital' : 'to patient'}
        </div>
      )}
    </div>
  )
}
