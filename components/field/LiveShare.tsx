'use client'
// Shares the phone's location while the team travels: to the patient (Start journey → check-in) and back to the
// hospital (check-out → arrival). Staff can't stop it — it ends when the server says the trip is over. Browsers
// only report location while the app is open, so the screen is kept awake and a banner says so.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LocateFixed, LocateOff, Navigation } from 'lucide-react'
import { api } from '@/components/client'
import { cx } from '@/lib/format'

const EVERY_MS = 15_000 // at most one point per 15 s…
const MOVED_M = 50 // …or sooner after moving this far
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
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null)
  const lastFix = useRef(Date.now())
  const sending = useRef(false)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState('unsupported')
      return
    }
    let stopped = false
    // keep the screen on while travelling (released automatically when the tab is hidden; re-acquired on return)
    let lock: any = null
    const wake = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen')
      } catch {}
    }
    wake()
    const onVis = () => document.visibilityState === 'visible' && wake()
    document.addEventListener('visibilitychange', onVis)

    const watch = navigator.geolocation.watchPosition(
      async (p) => {
        lastFix.current = Date.now()
        const pt = { lat: p.coords.latitude, lng: p.coords.longitude }
        setAcc(Math.round(p.coords.accuracy))
        setState('ok')
        const prev = last.current
        if (prev && Date.now() - prev.t < EVERY_MS && dist(prev, pt) < MOVED_M) return
        if (sending.current || !navigator.onLine) return
        sending.current = true
        last.current = { ...pt, t: Date.now() }
        try {
          const r = await api<{ active: boolean; reached?: boolean }>(`/requests/${requestId}/location`, {
            body: { ...pt, accuracyM: Math.round(p.coords.accuracy), heading: p.coords.heading, speed: p.coords.speed, deviceAt: new Date().toISOString() },
          })
          if (!r.active && !stopped) router.refresh() // checked in / back at the hospital: the screen moves on
        } catch {
          // offline or a blip: the next point retries
        } finally {
          sending.current = false
        }
      },
      (e) => setState(e.code === 1 ? 'denied' : 'nofix'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
    const silent = setInterval(() => {
      if (Date.now() - lastFix.current > SILENT_MS) setState((s) => (s === 'denied' ? s : 'nofix'))
    }, 10_000)
    return () => {
      stopped = true
      navigator.geolocation.clearWatch(watch)
      clearInterval(silent)
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.().catch?.(() => {})
    }
  }, [requestId, router])

  const bad = state === 'denied' || state === 'nofix' || state === 'unsupported'
  const where = phase === 'OUT' ? 'on the way to the patient' : 'returning to the hospital'
  return (
    <div className={cx('flex items-center gap-3 px-4 text-[13.5px]', compact ? 'py-2 shadow-sm' : 'rounded-card py-3 shadow-card', bad ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#ECFDF5] text-[#065F46]')} role="status">
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
                  : `Live location shared · ${where}`}
        </div>
        <div className="text-[12px] opacity-80">{bad ? 'The coordinator is alerted when your location stops.' : `Keep this screen open while travelling${acc != null ? ` · GPS ±${acc} m` : ''}`}</div>
      </div>
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
