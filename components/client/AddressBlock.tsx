'use client'
// One address block for every form (public booking, patient profile, staff new-request web + app):
// GPS with a strict accuracy rule, address search, house / flat, area, landmark, always-visible pin map.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Crosshair, Loader2, MapPin } from 'lucide-react'
import { AddressSearchInput, PinPicker, reportUsage, reverseGeocode } from './maps'
import { cx } from '@/lib/format'

export type AddressValue = { road: string; house: string; flat: string; area: string; landmark: string; lat: number | null; lng: number | null }
export type AddressMeta = { source: 'typed' | 'gps' | 'search' | 'pin'; accuracyM?: number; autoFields: string[] }
export type AddressLabels = typeof EN

const EN = {
  useLocation: 'Use my current location',
  locating: 'Finding your location…',
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

// strict accuracy rule: refine for up to 20 s; auto-fill text only when the fix is within 60 m; ignore fixes worse than 300 m
const TARGET_M = 25
const MAX_WAIT_MS = 20_000
const FILL_MAX_M = 60
const PIN_MAX_M = 300

/** Keep watching the GPS until a fix within TARGET_M arrives (or time runs out) and return the best one. */
function bestFix(onUpdate: (acc: number) => void): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null
    let lastErr: GeolocationPositionError | null = null
    let id = 0
    const finish = () => {
      navigator.geolocation.clearWatch(id)
      clearTimeout(timer)
      best ? resolve(best) : reject(lastErr ?? new Error('no fix'))
    }
    const timer = setTimeout(finish, MAX_WAIT_MS)
    id = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p
        onUpdate(Math.round(best.coords.accuracy))
        if (p.coords.accuracy <= TARGET_M) finish()
      },
      (e) => {
        lastErr = e
        if (e.code === 1 || !best) finish()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_WAIT_MS },
    )
  })
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
  requireHouse = true,
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
  /** extra fields rendered after the landmark (e.g. requester on the staff form) */
  children?: ReactNode
}) {
  const [auto, setAuto] = useState<string[]>([])
  const [meta, setMetaState] = useState<AddressMeta>({ source: 'typed', autoFields: [] })
  const [locating, setLocating] = useState<null | number>(null) // live accuracy while refining
  const [acc, setAcc] = useState<number | null>(null)
  const [locMsg, setLocMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const tried = useRef(false)
  const vRef = useRef(v)
  vRef.current = v
  const input = cx('hc-input', size === 'lg' && 'hc-input-lg !text-[16px]')
  const has = v.lat != null && v.lng != null

  const setMeta = (m: AddressMeta) => {
    setMetaState(m)
    onMeta?.(m)
  }
  const set = (k: keyof AddressValue, val: AddressValue[keyof AddressValue]) => {
    onChange({ [k]: val })
    if (auto.includes(k)) {
      const next = auto.filter((x) => x !== k)
      setAuto(next)
      setMeta({ ...meta, autoFields: next })
    }
  }
  const tag = (k: string) => (auto.includes(k) ? L.autoTag : undefined)

  async function locate(silent = false) {
    if (!('geolocation' in navigator)) return silent ? undefined : setLocMsg({ tone: 'err', text: L.eLocNone })
    setLocating(0)
    setLocMsg(null)
    try {
      const p = await bestFix((a) => setLocating(a))
      reportUsage('device', 'gps')
      const accuracy = Math.round(p.coords.accuracy)
      setAcc(accuracy)
      if (accuracy > PIN_MAX_M) {
        setLocMsg({ tone: 'err', text: L.accBad })
        return
      }
      const lat = Math.round(p.coords.latitude * 1e6) / 1e6
      const lng = Math.round(p.coords.longitude * 1e6) / 1e6
      const patch: Partial<AddressValue> = { lat, lng }
      let filled: string[] = []
      if (accuracy <= FILL_MAX_M) {
        const place = await reverseGeocode(lat, lng)
        const cur = vRef.current
        const may = (k: keyof AddressValue) => !String(cur[k] ?? '').trim() || auto.includes(k)
        const zone = place?.area ? zones.find((z) => z.toLowerCase().includes(place.area.toLowerCase()) || place.area.toLowerCase().includes(z.toLowerCase())) : undefined
        if (place?.road && may('road')) (patch.road = place.road), filled.push('road')
        if ((zone || place?.area) && may('area')) (patch.area = zone || place!.area), filled.push('area')
        if (place?.landmark && may('landmark')) (patch.landmark = place.landmark), filled.push('landmark')
        setLocMsg({ tone: 'ok', text: L.accGood(accuracy) })
      } else setLocMsg({ tone: 'warn', text: L.accPoor(accuracy) })
      onChange(patch)
      filled = [...new Set([...auto, ...filled])]
      setAuto(filled)
      setMeta({ source: 'gps', accuracyM: accuracy, autoFields: filled })
    } catch (e: any) {
      if (silent) return
      setLocMsg({ tone: 'err', text: e?.code === 1 ? L.eLocBlocked : L.eLocFail })
    } finally {
      setLocating(null)
    }
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

  const Field = ({ k, label, hint, children }: { k: keyof AddressValue; label: string; hint?: string; children: ReactNode }) => {
    const error = errors[k]
    const tg = tag(k)
    return (
      <div className={cx(error && '[&_.hc-input]:border-[#DC2626]', tg && !error && '[&_.hc-input]:border-[#86EFAC] [&_.hc-input]:bg-[#F0FDF4]')}>
        <label htmlFor={`${idPrefix}-${k}`} className={cx('hc-label flex items-center gap-2', size === 'lg' && '!text-[13.5px]')}>
          {label}
          {tg && <span className="rounded-full bg-[#DCFCE7] px-2 py-px text-[11px] font-semibold text-[#15803D]">✓ {tg}</span>}
        </label>
        {children}
        {error ? <div className="mt-1 text-[13px] font-medium text-[#B91C1C]">{error}</div> : hint && <div className="mt-1 text-[12.5px] text-slate-500">{hint}</div>}
      </div>
    )
  }

  return (
    <div ref={root} className="flex flex-col gap-3.5">
      <button
        type="button"
        onClick={() => locate()}
        disabled={locating != null}
        className={cx('flex w-full items-center justify-center gap-2 rounded-lg border-[1.5px] px-3 font-semibold', size === 'lg' ? 'h-[52px] text-[15px]' : 'h-10 text-[13.5px]', has && meta.source === 'gps' ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]' : 'border-primary/40 bg-primary-50 text-primary-700')}
      >
        {locating != null ? <Loader2 size={18} className="animate-spin" /> : has && meta.source === 'gps' ? <Check size={18} /> : <Crosshair size={18} />}
        {locating != null ? `${L.locating}${locating ? ` ±${locating} m` : ''}` : has && meta.source === 'gps' ? L.located : L.useLocation}
      </button>
      {locMsg && <div className={cx('rounded-lg px-3 py-2 text-[13px]', locMsg.tone === 'ok' ? 'bg-[#DCFCE7] text-[#15803D]' : locMsg.tone === 'warn' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FEE2E2] text-[#B91C1C]')}>{locMsg.text}</div>}

      <Field k="road" label={L.road} hint={L.roadHint}>
        <div id={`${idPrefix}-road`}>
          <AddressSearchInput
            className={input}
            value={v.road}
            onChange={(road) => set('road', road)}
            onPlace={(p) => {
              onChange({ road: p.full, lat: p.lat, lng: p.lng })
              const next = [...new Set([...auto, 'road'])]
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
        <Field k="house" label={requireHouse ? L.house : `${L.house}`}>
          <input id={`${idPrefix}-house`} className={input} value={v.house} onChange={(e) => set('house', e.target.value)} placeholder={L.housePh} />
        </Field>
        <Field k="flat" label={L.flat}>
          <input id={`${idPrefix}-flat`} className={input} value={v.flat} onChange={(e) => set('flat', e.target.value)} placeholder={L.flatPh} />
        </Field>
      </div>
      <div className={cx('grid gap-3', size === 'md' && 'sm:grid-cols-2')}>
        <Field k="area" label={L.area}>
          <input id={`${idPrefix}-area`} className={input} value={v.area} onChange={(e) => set('area', e.target.value)} list={`${idPrefix}-zones`} placeholder={L.areaPh} autoComplete="off" />
          <datalist id={`${idPrefix}-zones`}>
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field k="landmark" label={L.landmark}>
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
          onChange={(p) => {
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
