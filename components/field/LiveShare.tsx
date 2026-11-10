'use client'
// Shares the phone's location while the team travels: to the patient (Start journey → check-in) and back to the
// hospital (check-out → arrival). Staff can't stop it — it ends when the server says the trip is over.
// Browsers only report location while the app is on screen, so:
//  · the screen is kept awake (Wake Lock; NoSleep video fallback on phones without it) and a banner says so,
//  · besides moving points, a heartbeat sends a fresh fix every 20 s even when standing still (traffic jams),
//  · a send that hangs is given up after 10 s, so it never blocks the next one,
//  · leaving the app (screen locked / another app) sends a "paused" beacon — the coordinator sees "Paused", not
//    "Signal lost" — and coming back sends a point at once.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, LocateFixed, LocateOff, Navigation } from 'lucide-react'
import { api } from '@/components/client'
import { cx } from '@/lib/format'

const MOVING_MS = 5_000 // Uber-style: a point every 5 s while moving…
const MOVED_M = 15 // …"moving" = at least this far since the last point
const HEARTBEAT_MS = 20_000 // and a point every 20 s while standing still (traffic jam, waiting)
const SEND_TIMEOUT_MS = 10_000
const SILENT_MS = 60_000 // no fix for this long → red banner

function dist(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const t = (d: number) => (d * Math.PI) / 180
  const x = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2
  return 2 * 6371e3 * Math.asin(Math.sqrt(x))
}

type State = 'starting' | 'ok' | 'denied' | 'nofix' | 'unsupported'

export function LiveShare({ requestId, phase, compact = false }: { requestId: string; phase: 'OUT' | 'RETURN'; compact?: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<State>('starting')
  const [acc, setAcc] = useState<number | null>(null)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [rough, setRough] = useState(false)
  const [awake, setAwake] = useState<'yes' | 'no' | 'tap'>('yes')
  const [, tick] = useState(0)
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null)
  const lastFix = useRef(Date.now())
  const sending = useRef(false)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState('unsupported')
      return
    }
    let stopped = false
    const url = `/api/v1/requests/${requestId}/location`

    // ---- keep the screen on while travelling
    let lock: any = null
    let noSleep: any = null
    const wake = async () => {
      if (noSleep) return
      try {
        lock = await (navigator as any).wakeLock.request('screen')
        setAwake('yes')
      } catch {
        setAwake('no') // refused (battery saver / low power mode) — the banner asks staff to keep the screen on
      }
    }
    const tapToWake = async () => {
      // phones without the Wake Lock API: a muted looping video keeps the screen on, started by a tap
      if (noSleep) return
      try {
        const NoSleep = (await import('nosleep.js')).default
        noSleep = new NoSleep()
        await noSleep.enable()
        setAwake('yes')
      } catch {
        noSleep = null
        setAwake('no')
      }
    }
    if ((navigator as any).wakeLock) wake()
    else {
      setAwake('tap')
      document.addEventListener('click', tapToWake, { once: true, capture: true })
      document.addEventListener('touchend', tapToWake, { once: true, capture: true })
    }

    // ---- send one point (never two at once; a hung request is dropped after 10 s)
    const send = async (p: GeolocationPosition, force = false) => {
      const pt = { lat: p.coords.latitude, lng: p.coords.longitude }
      const prev = last.current
      if (!force && prev) {
        const since = Date.now() - prev.t
        const moving = dist(prev, pt) >= MOVED_M || (p.coords.speed ?? 0) > 2
        if (since < MOVING_MS || (!moving && since < HEARTBEAT_MS)) return
      }
      if (sending.current || !navigator.onLine) return
      sending.current = true
      last.current = { ...pt, t: Date.now() }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS)
      try {
        const r = await api<{ active: boolean; reached?: boolean; rough?: boolean }>(`/requests/${requestId}/location`, {
          body: { ...pt, accuracyM: Math.round(p.coords.accuracy), heading: p.coords.heading, speed: p.coords.speed, deviceAt: new Date().toISOString() },
          signal: ctrl.signal,
        })
        setSentAt(Date.now())
        setRough(!!r.rough)
        if (!r.active && !stopped) router.refresh() // checked in / back at the hospital: the screen moves on
      } catch {
        // offline, timed out or a blip: the next point retries
      } finally {
        clearTimeout(timer)
        sending.current = false
      }
    }
    const onFix = (p: GeolocationPosition, force = false) => {
      lastFix.current = Date.now()
      setAcc(Math.round(p.coords.accuracy))
      setState('ok')
      void send(p, force)
    }
    const onErr = (e: GeolocationPositionError) => setState(e.code === 1 ? 'denied' : 'nofix')
    const fixNow = () => navigator.geolocation.getCurrentPosition((p) => onFix(p, true), onErr, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 })

    const watch = navigator.geolocation.watchPosition((p) => onFix(p), onErr, { enableHighAccuracy: true, maximumAge: 3_000, timeout: 30_000 })
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible' && (!last.current || Date.now() - last.current.t >= HEARTBEAT_MS)) fixNow()
    }, 5_000)
    const silent = setInterval(() => {
      if (Date.now() - lastFix.current > SILENT_MS) setState((s) => (s === 'denied' ? s : 'nofix'))
      tick((n) => n + 1) // keeps "shared N s ago" current
    }, 10_000)

    // ---- leaving / coming back to the app
    const paused = () => {
      try {
        navigator.sendBeacon?.(url, new Blob([JSON.stringify({ paused: true })], { type: 'application/json' }))
      } catch {}
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') return paused()
      if ((navigator as any).wakeLock) wake()
      fixNow() // back on screen: share where we are right away
    }
    const onShow = () => fixNow()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', paused)
    window.addEventListener('pageshow', onShow)

    return () => {
      stopped = true
      navigator.geolocation.clearWatch(watch)
      clearInterval(heartbeat)
      clearInterval(silent)
      document.removeEventListener('visibilitychange', onVis)
      document.removeEventListener('click', tapToWake, true)
      document.removeEventListener('touchend', tapToWake, true)
      window.removeEventListener('pagehide', paused)
      window.removeEventListener('pageshow', onShow)
      lock?.release?.().catch?.(() => {})
      noSleep?.disable?.()
    }
  }, [requestId, router])

  const bad = state === 'denied' || state === 'nofix' || state === 'unsupported'
  const where = phase === 'OUT' ? 'on the way to the patient' : 'returning to the hospital'
  const secs = sentAt ? Math.max(0, Math.round((Date.now() - sentAt) / 1000)) : null
  const shared = secs == null ? 'not sent yet' : secs < 60 ? `shared ${secs} s ago` : `shared ${Math.round(secs / 60)} min ago`
  return (
    <div className={cx(compact ? 'shadow-sm' : 'overflow-hidden rounded-card shadow-card')}>
      <div className={cx('flex items-center gap-3 px-4 text-[13.5px]', compact ? 'py-2' : 'py-3', bad ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#ECFDF5] text-[#065F46]')} role="status">
        <span className={cx('relative flex flex-none items-center justify-center rounded-full bg-white', compact ? 'size-7' : 'size-9')}>
          {bad ? <LocateOff size={18} /> : phase === 'OUT' ? <Navigation size={18} /> : <LocateFixed size={18} />}
          {!bad && <span className="absolute -right-0.5 -top-0.5 size-3 animate-ping rounded-full bg-[#10B981]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">
            {state === 'denied'
              ? 'Location is blocked — allow location for this site'
              : state === 'unsupported'
                ? 'This phone does not share location'
                : state === 'nofix'
                  ? 'Location off — turn on GPS'
                  : state === 'starting'
                    ? 'Starting live location…'
                    : `Live location · ${where}`}
          </div>
          <div className="text-[12px] opacity-80">
            {bad
              ? 'The coordinator is alerted when your location stops.'
              : `${shared}${acc != null ? ` · GPS ±${acc} m` : ''}${rough ? ' · signal too rough to place — move to open sky' : ''}`}
          </div>
        </div>
      </div>
      {!bad && (
        <div className={cx('flex items-start gap-2 px-4 py-2 text-[12px] leading-[17px]', awake === 'yes' ? 'bg-[#F8FAFC] text-slate-600' : 'bg-[#FEF3C7] text-[#92400E]')}>
          <AlertTriangle size={14} className="mt-px flex-none" />
          {awake === 'tap'
            ? 'Tap the screen once to keep it awake. Keep this app open while travelling — location stops if you lock the phone or switch apps.'
            : awake === 'no'
              ? 'Your phone may lock the screen (battery saver). Keep this app open and the screen on while travelling — location stops when the screen locks.'
              : 'Keep this app open while travelling — location pauses if you lock the phone or switch to another app.'}
        </div>
      )}
    </div>
  )
}

/** Ask for location permission before starting a journey (live tracking on). Resolves false if refused. */
export function ensureLocation(): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((res) => {
    if (!('geolocation' in navigator)) return res({ ok: false, message: 'This phone does not share location' })
    navigator.geolocation.getCurrentPosition(
      () => res({ ok: true }),
      (e) => res({ ok: false, message: e.code === 1 ? 'Allow location for this site to start the journey (live location is required)' : 'Turn on GPS / location to start the journey' }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  })
}
