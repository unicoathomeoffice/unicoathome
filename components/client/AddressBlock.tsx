'use client'
// One address block for every form (public booking, patient profile, staff new-request web + app):
// GPS that keeps improving live, address search, house / flat, area, landmark, always-visible pin map.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crosshair, Loader2, MapPin } from 'lucide-react'
import { AddressSearchInput, PinPicker, reportUsage, reverseGeocode } from './maps'
import { cx } from '@/lib/format'

export type AddressValue = { road: string; house: string; flat: string; area: string; landmark: string; lat: number | null; lng: number | null }
export type AddressMeta = { source: 'typed' | 'gps' | 'search' | 'pin'; accuracyM?: number; autoFields: string[] }
export type AddressLabels = typeof EN

const EN = {
  useLocation: 'Use my current location',
  locating: 'Finding your location…',
  improving: 'Improving accuracy',
  stop: 'Stop',
  located: 'Location added — tap to update',
  autoTag: 'Auto-filled',
  road: 'Road, block & area',
  roadHint: 'Start typing to pick from the map',
  roadPh: 'e.g. Road 11, Block C, Banani',
  house: 'House / holding no.',
  housePh: 'e.g. 24/B',
  flat: 'Flat / floor',
  flatPh: 'e.g. 5A, 5th floor',
  area: 'Area / thana (optional)',
  areaPh: 'e.g. Dhanmondi',
  landmark: 'Nearby landmark (optional)',
  landmarkPh: 'Near…',
  onMap: 'Location on the map',
  mapHint: 'Drag the pin or tap the map so the team finds the exact door.',
  pinTap: 'Tap the map to drop a pin',
  pinNone: 'No pin yet',
  pinSet: 'Pinned',
  myLocation: 'My location',
  clearPin: 'Clear pin',
  accGood: (m: number) => `Accurate to ±${m} m`,
  accPoor: (m: number) => `Only ±${m} m accurate — go near a window or outside and tap again, or drag the pin to the door`,
  accBad: 'Could not get an accurate position on this device — type the address or drag the pin',
  eLocBlocked: 'Location permission was blocked — allow it, or type the address',
  eLocFail: 'Could not get your location — type the address instead',
  eLocNone: 'This device does not share its location — type the address instead',
}

// Strict accuracy rules. The phone's first fix is often coarse (cell / Wi-Fi) and GPS sharpens over the next
// 10–60 s, so we keep watching and move the pin every time a better fix arrives:
const DONE_M = 12 // stop early once this good
const FILL_MAX_M = 60 // "accurate" threshold for the green / amber message
const PIN_MAX_M = 300 // never drop a pin from a fix worse than this
const MAX_WATCH_MS = 45_000
const FIRST_FIX_MS = 25_000 // give up if nothing usable by then
const STALL_MS = 10_000 // no better fix for this long → the device has settled, stop
const REGEOCODE_M = 25 // re-run address lookup when the position moved more than this

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Lives outside AddressBlock on purpose: a component declared inside render is a new type every render, so React
// remounted every input on each GPS tick (~1/s on phones) — the keyboard closed and the search box reset mid-typing.
function Field({ id, label, hint, error, tag, size, required, children }: { id: string; label: string; hint?: string; error?: string; tag?: string; size: 'lg' | 'md'; required?: boolean; children: ReactNode }) {
  return (
    <div className={cx(error && '[&_.hc-input]:border-[#DC2626]', tag && !error && '[&_.hc-input]:border-[#86EFAC] [&_.hc-input]:bg-[#F0FDF4]')}>
      <label htmlFor={id} className={cx('hc-label flex items-center gap-2', size === 'lg' && '!text-[13.5px]')}>
        {label}
        {required && <span className="-ml-1 text-[#DC2626]">*</span>}
        {tag && <span className="rounded-full bg-[#DCFCE7] px-2 py-px text-[11px] font-semibold text-[#15803D]">✓ {tag}</span>}
      </label>
      {children}
      {error ? <div className="mt-1 text-[13px] font-medium text-[#B91C1C]">{error}</div> : hint && <div className="mt-1 text-[12.5px] text-slate-500">{hint}</div>}
    </div>
  )
}

export function AddressBlock({
  value: v,
  onChange,
  onMeta,
  zones,
  labels: L = EN,
  errors = {},
  autoDetect = false,
  size = 'lg',
  mapHeight = 260,
  idPrefix = 'f',
  locateInto,
  required,
  children,
}: {
  value: AddressValue
  onChange: (patch: Partial<AddressValue>) => void
  onMeta?: (meta: AddressMeta) => void
  zones: string[]
  labels?: AddressLabels
  errors?: Partial<Record<keyof AddressValue, string>>
  /** ask the device for its position when the block scrolls into view (touch devices only — laptops guess from Wi-Fi/IP) */
  autoDetect?: boolean
  size?: 'lg' | 'md'
  mapHeight?: number
  idPrefix?: string
  requireHouse?: boolean
  /** undefined → full-width "Use my current location" bar on top (default). An element → the button is rendered
   *  into it as a compact pill (e.g. the section header); null → that host is not mounted yet, render nothing. */
  locateInto?: HTMLElement | null
  /** red asterisk on these labels */
  required?: Partial<Record<keyof AddressValue, boolean>>
  /** extra fields rendered after the landmark (e.g. requester on the staff form) */
  children?: ReactNode
}) {
  const [auto, setAuto] = useState<string[]>([])
  const [meta, setMetaState] = useState<AddressMeta>({ source: 'typed', autoFields: [] })
  const [tracking, setTracking] = useState<null | number>(null) // live accuracy while the GPS sharpens
  const [acc, setAcc] = useState<number | null>(null)
  const [locMsg, setLocMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const tried = useRef(false)
  const vRef = useRef(v)
  vRef.current = v
  const autoRef = useRef(auto)
  autoRef.current = auto
  const watch = useRef<{ id: number; timers: number[]; silent: boolean; stall?: number } | null>(null)
  const run = useRef(0) // bumped when a new GPS run starts or the user takes over — stale address lookups are dropped
  const best = useRef<{ lat: number; lng: number; acc: number } | null>(null)
  const geocodedAt = useRef<{ lat: number; lng: number } | null>(null)
  const input = cx('hc-input', size === 'lg' && 'hc-input-lg !text-[16px]')
  const has = v.lat != null && v.lng != null

  const setMeta = (m: AddressMeta) => {
    setMetaState(m)
    onMeta?.(m)
  }
  const set = (k: keyof AddressValue, val: AddressValue[keyof AddressValue]) => {
    onChange({ [k]: val })
    if (autoRef.current.includes(k)) {
      const next = autoRef.current.filter((x) => x !== k)
      setAuto(next)
      setMeta({ ...meta, autoFields: next })
    }
  }
  const tag = (k: string) => (auto.includes(k) ? L.autoTag : undefined)

  function stopTracking() {
    if (!watch.current) return
    navigator.geolocation.clearWatch(watch.current.id)
    watch.current.timers.forEach(clearTimeout)
    clearTimeout(watch.current.stall)
    watch.current = null
    setTracking(null)
  }
  /** the user chose the position themselves (search / pin): stop the GPS and ignore any lookup still in flight */
  function takeOver() {
    run.current++
    stopTracking()
  }
  useEffect(() => () => stopTracking(), [])

  /** fill road / area / landmark from the position (only boxes that are empty or were auto-filled before) */
  async function fillFrom(p: { lat: number; lng: number }) {
    geocodedAt.current = p
    const mine = run.current
    const place = await reverseGeocode(p.lat, p.lng)
    // Only drop the result if the user took over or restarted. (It used to be dropped whenever tracking had ended —
    // but a ±12 m fix ends tracking at once, so on phones the best fix never filled road / area / landmark.)
    if (!place || mine !== run.current) return
    const cur = vRef.current
    const may = (k: keyof AddressValue) => !String(cur[k] ?? '').trim() || autoRef.current.includes(k)
    const zone = place.area ? zones.find((z) => z.toLowerCase().includes(place.area.toLowerCase()) || place.area.toLowerCase().includes(z.toLowerCase())) : undefined
    const patch: Partial<AddressValue> = {}
    const filled: string[] = []
    if (place.road && may('road')) (patch.road = place.road), filled.push('road')
    if ((zone || place.area) && may('area')) (patch.area = zone || place.area), filled.push('area')
    if (place.landmark && may('landmark')) (patch.landmark = place.landmark), filled.push('landmark')
    if (Object.keys(patch).length) onChange(patch)
    const next = [...new Set([...autoRef.current, ...filled])]
    setAuto(next)
    setMeta({ source: 'gps', accuracyM: best.current?.acc, autoFields: next })
  }

  /** Start (or restart) live tracking, Google-Maps style: the FIRST fix already places the dot and fills the address;
   *  every better fix moves the dot (and re-fills once it moved > REGEOCODE_M). Stops at DONE_M, when no better fix
   *  has arrived for STALL_MS, after MAX_WATCH_MS, or when the user takes over. A laptop has no GPS — its one
   *  Wi-Fi / IP fix never improves — so there we stop right after the first fix instead of making people wait. */
  function locate(silent = false) {
    if (!('geolocation' in navigator)) return silent ? undefined : setLocMsg({ tone: 'err', text: L.eLocNone })
    takeOver()
    best.current = null
    geocodedAt.current = null
    setLocMsg(null)
    setTracking(0)
    const started = Date.now()
    const hasGps = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const finish = () => {
      const b = best.current
      stopTracking()
      if (!b) {
        if (!silent) setLocMsg({ tone: 'err', text: L.eLocFail })
        return
      }
      // Indoors the phone may never get better than ±100–300 m. Still fill road / area / landmark from the best fix
      // (marked "Auto-filled", so the patient can correct it) instead of leaving every box empty.
      if (b.acc <= PIN_MAX_M && !geocodedAt.current) fillFrom(b)
      setLocMsg(b.acc <= FILL_MAX_M ? { tone: 'ok', text: L.accGood(b.acc) } : b.acc <= PIN_MAX_M ? { tone: 'warn', text: L.accPoor(b.acc) } : { tone: 'err', text: L.accBad })
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = Math.round(pos.coords.accuracy)
        setTracking(accuracy)
        if (best.current && accuracy >= best.current.acc) return // not better than what we have
        const p = { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6, acc: accuracy }
        if (!best.current) reportUsage('device', 'gps')
        best.current = p
        setAcc(accuracy)
        if (accuracy <= PIN_MAX_M) {
          onChange({ lat: p.lat, lng: p.lng })
          setMeta({ source: 'gps', accuracyM: accuracy, autoFields: autoRef.current })
          if (!geocodedAt.current || metres(geocodedAt.current, p) > REGEOCODE_M) fillFrom(p)
        }
        if (accuracy <= DONE_M || !hasGps) return finish()
        if (watch.current) {
          clearTimeout(watch.current.stall)
          watch.current.stall = window.setTimeout(finish, STALL_MS)
        }
      },
      (e) => {
        if (e.code === 1) {
          stopTracking()
          if (!silent) setLocMsg({ tone: 'err', text: L.eLocBlocked })
        } else if (!best.current && Date.now() - started > FIRST_FIX_MS) finish()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: FIRST_FIX_MS },
    )
    const t1 = window.setTimeout(() => !best.current && finish(), FIRST_FIX_MS)
    const t2 = window.setTimeout(finish, MAX_WATCH_MS)
    watch.current = { id, timers: [t1, t2], silent }
  }

  // auto-detect once the block is on screen (phones/tablets only)
  useEffect(() => {
    if (!autoDetect || !root.current || !('geolocation' in navigator) || !window.matchMedia?.('(pointer: coarse)').matches) return
    const go = () => {
      if (tried.current) return
      tried.current = true
      locate(true)
    }
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((st) => st.state === 'granted' && go())
      .catch(() => {})
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && go(), { threshold: 0.35 })
    io.observe(root.current)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetect])

  const fp = (k: keyof AddressValue) => ({ id: `${idPrefix}-${k}`, error: errors[k], tag: tag(k), size, required: required?.[k] })

  const gpsPinned = has && meta.source === 'gps'
  // Google-Maps-like: "Finding your location…" only until the first fix; after that the button already says
  // "Location added" while the blue dot keeps tightening quietly in the background — no ±m countdown, no Stop.
  // A background auto-detect with no fix yet (permission prompt pending / ignored) never locks the button either:
  // a tap restarts it from a real user gesture.
  const live = tracking != null && has && meta.source === 'gps'
  const busy = tracking != null && !best.current && !watch.current?.silent
  const compact = locateInto !== undefined
  const locateBtn = (
    <button
      type="button"
      onClick={() => locate()}
      disabled={busy}
      className={cx(
        'flex items-center justify-center gap-2 border-[1.5px] font-semibold',
        compact ? 'h-9 max-w-[240px] rounded-full px-3 text-[13px]' : cx('min-w-0 flex-1 rounded-lg px-3', size === 'lg' ? 'h-[52px] text-[15px]' : 'h-10 text-[13.5px]'),
        gpsPinned ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]' : compact ? 'border-primary/50 bg-white text-primary-700 hover:bg-primary-50' : 'border-primary/40 bg-primary-50 text-primary-700',
      )}
    >
      {busy ? <Loader2 size={compact ? 15 : 18} className="flex-none animate-spin" /> : gpsPinned ? <Check size={compact ? 15 : 18} className="flex-none" /> : compact ? <MapPin size={15} className="flex-none" /> : <Crosshair size={18} className="flex-none" />}
      <span className="truncate">{busy ? L.locating : gpsPinned ? L.located : L.useLocation}</span>
    </button>
  )
  return (
    <div ref={root} className="flex flex-col gap-3.5">
      {locateInto === undefined ? <div className="flex gap-2">{locateBtn}</div> : locateInto ? createPortal(locateBtn, locateInto) : null}
      {locMsg && <div className={cx('rounded-lg px-3 py-2 text-[13px]', locMsg.tone === 'ok' ? 'bg-[#DCFCE7] text-[#15803D]' : locMsg.tone === 'warn' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FEE2E2] text-[#B91C1C]')}>{locMsg.text}</div>}

      <Field {...fp('road')} label={L.road} hint={L.roadHint}>
        <div id={`${idPrefix}-road`}>
          <AddressSearchInput
            className={input}
            value={v.road}
            onChange={(road) => set('road', road)}
            onPlace={(p) => {
              takeOver()
              onChange({ road: p.full, lat: p.lat, lng: p.lng })
              const next = [...new Set([...autoRef.current, 'road'])]
              setAuto(next)
              setAcc(null)
              setLocMsg(null)
              setMeta({ source: 'search', autoFields: next })
            }}
            placeholder={L.roadPh}
          />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field {...fp('house')} label={L.house}>
          <input id={`${idPrefix}-house`} className={input} value={v.house} onChange={(e) => set('house', e.target.value)} placeholder={L.housePh} />
        </Field>
        <Field {...fp('flat')} label={L.flat}>
          <input id={`${idPrefix}-flat`} className={input} value={v.flat} onChange={(e) => set('flat', e.target.value)} placeholder={L.flatPh} />
        </Field>
      </div>
      <div className={cx('grid gap-3', size === 'md' && 'sm:grid-cols-2')}>
        <Field {...fp('area')} label={L.area}>
          <input id={`${idPrefix}-area`} className={input} value={v.area} onChange={(e) => set('area', e.target.value)} list={`${idPrefix}-zones`} placeholder={L.areaPh} autoComplete="off" />
          <datalist id={`${idPrefix}-zones`}>
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field {...fp('landmark')} label={L.landmark}>
          <input id={`${idPrefix}-landmark`} className={input} value={v.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder={L.landmarkPh} />
        </Field>
      </div>
      {children}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-700">
          <MapPin size={15} /> {L.onMap}
        </div>
        <PinPicker
          height={mapHeight}
          lat={v.lat}
          lng={v.lng}
          accuracyM={meta.source === 'gps' ? acc : null}
          live={live}
          hideLocate
          onChange={(p) => {
            // the user took over (drag / tap / clear): stop following the GPS
            takeOver()
            onChange({ lat: p?.lat ?? null, lng: p?.lng ?? null })
            setAcc(null)
            setLocMsg(null)
            setMeta({ ...meta, source: p ? 'pin' : 'typed', accuracyM: undefined })
          }}
          labels={{ tap: L.pinTap, none: L.pinNone, set: L.pinSet, myLocation: L.myLocation, clear: L.clearPin }}
        />
        <div className="mt-1 text-[12.5px] text-slate-500">{L.mapHint}</div>
      </div>
    </div>
  )
}

export const ADDRESS_LABELS_EN = EN
/** "House X, Flat Y, road" as stored in patient.address.full */
export const composeFull = (a: Pick<AddressValue, 'road' | 'house' | 'flat'>) => [a.house.trim() && `House ${a.house.trim()}`, a.flat.trim() && `Flat ${a.flat.trim()}`, a.road.trim()].filter(Boolean).join(', ')
/** the road part of a stored full address */
export const roadOf = (full?: string | null, house?: string | null, flat?: string | null) => (house || flat ? (full ?? '').replace(/^House [^,]*, (Flat [^,]*, )?/, '').replace(/^Flat [^,]*, /, '') : (full ?? ''))
