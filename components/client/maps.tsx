'use client'
// Address search + drop-pin map. Two free providers (see lib/maps.ts):
//  · no key (default): OpenStreetMap tiles via Leaflet, search via Photon (komoot) — no account, no billing
//  · NEXT_PUBLIC_GOOGLE_MAPS_API_KEY set: Google Maps JS API + Places API (New), loaded on demand
import { useEffect, useRef, useState } from 'react'
import { Crosshair, Loader2, MapPin, X } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import { MAPS_KEY, DHAKA } from '@/lib/maps'
import { cx } from '@/lib/format'

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID' // Google advanced markers need a map id
const BD_BBOX = '88.0,20.5,92.7,26.7' // Bangladesh, for Photon

// Google is used only while it works: any refusal (key, billing, quota) switches this page to OpenStreetMap.
let googleOff = !MAPS_KEY
const FALLBACK_EVENT = 'hc:maps-fallback'
function dropGoogle() {
  if (googleOff) return
  googleOff = true
  window.dispatchEvent(new Event(FALLBACK_EVENT))
}

/** Tell the server about a map / geocoding call (Settings → Maps & API usage counts them and caps Google). */
export function reportUsage(provider: 'google' | 'osm' | 'device', kind: 'places_autocomplete' | 'places_details' | 'maps_js' | 'photon_search' | 'photon_reverse' | 'osm_map' | 'gps') {
  try {
    const data = new Blob([JSON.stringify({ provider, kind })], { type: 'application/json' })
    if (!navigator.sendBeacon?.('/api/v1/public/maps-usage', data)) fetch('/api/v1/public/maps-usage', { method: 'POST', body: data, keepalive: true }).catch(() => {})
  } catch {}
}

/** Ask the server (cached) whether Google may be used right now (key, billing, daily budget); false → OpenStreetMap. */
let status: Promise<boolean> | null = null
export function googleUsable(): Promise<boolean> {
  if (googleOff) return Promise.resolve(false)
  status ??= fetch('/api/v1/public/maps-status')
    .then((r) => r.json())
    .then((j) => !!j.google)
    .catch(() => false)
    .then((ok) => {
      if (!ok) googleOff = true
      return ok
    })
  return status
}

let loading: Promise<any> | null = null
/** Load the Google Maps JS API once per page. Rejects when no key is configured or the key is refused. */
export function loadGoogleMaps(): Promise<any> {
  const w = window as any
  if (!MAPS_KEY) return Promise.reject(new Error('Google Maps is not configured'))
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google.maps)
  loading ??= new Promise((resolve, reject) => {
    w.__hcMapsReady = () => resolve(w.google.maps)
    w.gm_authFailure = () => {
      dropGoogle()
      reject(new Error('Google Maps key was refused'))
    }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&loading=async&language=en&region=BD&callback=__hcMapsReady`
    s.async = true
    s.onerror = () => {
      loading = null
      reject(new Error('Google Maps failed to load'))
    }
    document.head.appendChild(s)
  })
  return loading
}

const num = (v: any) => (typeof v === 'function' ? v() : v) as number
const point = (p: any) => (p ? { lat: num(p.lat), lng: num(p.lng) } : null)

export type PickedPlace = { full: string; lat: number; lng: number }
type Suggestion = { id: string; main: string; sub: string; pick: () => Promise<PickedPlace | null> }

// ---------------------------------------------------------------- search providers
let googleToken: any = null
async function googleSuggest(input: string): Promise<Suggestion[]> {
  const maps = await loadGoogleMaps()
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await maps.importLibrary('places')
  googleToken ??= new AutocompleteSessionToken()
  reportUsage('google', 'places_autocomplete')
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: googleToken, includedRegionCodes: ['bd'], locationBias: { center: DHAKA, radius: 30000 }, language: 'en' })
  return suggestions
    .map((s: any) => s.placePrediction)
    .filter(Boolean)
    .map((p: any) => ({
      id: p.placeId,
      main: p.mainText?.text ?? p.text?.text ?? '',
      sub: p.secondaryText?.text ?? '',
      pick: async () => {
        const place = p.toPlace()
        reportUsage('google', 'places_details')
        await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] }) // ends the billing session
        googleToken = null
        const at = point(place.location)
        const name = place.displayName && !String(place.formattedAddress ?? '').startsWith(place.displayName) ? `${place.displayName}, ` : ''
        return at ? { full: `${name}${place.formattedAddress ?? ''}`, ...at } : null
      },
    }))
}

async function photonSuggest(input: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(input)}&limit=6&lang=en&lat=${DHAKA.lat}&lon=${DHAKA.lng}&bbox=${BD_BBOX}`
  reportUsage('osm', 'photon_search')
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const { features = [] } = await res.json()
  return features.map((f: any, i: number) => {
    const p = f.properties ?? {}
    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const main = p.name || street || p.district || p.city || ''
    const sub = [p.name && street, p.district, p.city ?? p.county, p.state].filter((x) => x && x !== main).join(', ')
    const [lng, lat] = f.geometry?.coordinates ?? []
    return { id: `${p.osm_type}${p.osm_id ?? i}`, main, sub, pick: async () => (lat != null ? { full: [main, sub].filter(Boolean).join(', '), lat, lng } : null) }
  })
}

/**
 * Drop-in replacement for the address <input>: typing suggests places in Bangladesh (biased to Dhaka);
 * choosing one fills the address and its coordinates.
 */
export function AddressSearchInput({ value, onChange, onPlace, className, placeholder }: { value: string; onChange: (text: string) => void; onPlace: (p: PickedPlace) => void; className?: string; placeholder?: string }) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef(false) // only search on keystrokes, never on programmatic value changes
  const [provider, setProvider] = useState<'google' | 'osm'>('osm')

  useEffect(() => {
    if (!typed.current || value.trim().length < 3) {
      setItems([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        let found: Suggestion[]
        if (!(await googleUsable())) found = await photonSuggest(value, ctrl.signal)
        else
          try {
            found = await googleSuggest(value)
          } catch {
            dropGoogle()
            found = await photonSuggest(value, ctrl.signal)
          }
        setProvider(googleOff ? 'osm' : 'google')
        if (ctrl.signal.aborted) return
        setItems(found)
        setActive(-1)
        setOpen(true)
      } catch {
        if (!ctrl.signal.aborted) setItems([])
      }
    }, 400)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [value])

  async function choose(s: Suggestion) {
    setOpen(false)
    setBusy(true)
    try {
      typed.current = false
      const picked = await s.pick()
      if (picked) onPlace(picked)
      else onChange([s.main, s.sub].filter(Boolean).join(', '))
    } catch {
      onChange([s.main, s.sub].filter(Boolean).join(', '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          typed.current = true
          onChange(e.target.value)
        }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
          else if (e.key === 'Enter' && active >= 0) (e.preventDefault(), choose(items[active]))
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {busy && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      {open && items.length > 0 && (
        <div className="absolute inset-x-0 top-full z-[1000] mt-1 overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-card">
          {items.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              className={cx('flex w-full items-start gap-2.5 px-3 py-2 text-left', i === active ? 'bg-primary-50' : 'hover:bg-slate-50')}
            >
              <MapPin size={16} className="mt-0.5 flex-none text-slate-400" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-slate-800">{s.main}</span>
                {s.sub && <span className="block truncate text-[12px] text-slate-500">{s.sub}</span>}
              </span>
            </button>
          ))}
          <div className="border-t border-slate-100 px-3 py-1 text-right text-[10.5px] text-slate-400">{provider === 'google' ? 'powered by Google' : 'Search © OpenStreetMap contributors · Photon'}</div>
        </div>
      )}
    </div>
  )
}

/** GPS point → readable address parts (Photon / OpenStreetMap, free). Null when nothing useful is found.
 *  landmark = the nearest named place (a shop, hospital, school…), road = street + area, area = neighbourhood. */
export async function reverseGeocode(lat: number, lng: number): Promise<{ road: string; area: string; landmark: string; full: string } | null> {
  try {
    reportUsage('osm', 'photon_reverse')
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`)
    if (!res.ok) return null
    const p = (await res.json()).features?.[0]?.properties
    if (!p) return null
    const isStreet = p.osm_key === 'highway' || p.type === 'street'
    const street = [p.housenumber, p.street ?? (isStreet ? p.name : undefined)].filter(Boolean).join(' ')
    const area = String(p.district ?? p.locality ?? p.suburb ?? p.county ?? '')
    const city = String(p.city ?? p.state ?? '')
    const landmark = !isStreet && p.name && p.osm_key !== 'place' && p.osm_key !== 'boundary' ? String(p.name) : ''
    const uniq = (xs: string[]) => xs.filter((x, i) => x && xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
    const road = uniq([street, area, city]).join(', ')
    return { road, area, landmark, full: uniq([landmark, street, area, city]).join(', ') }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- pin picker
/** What PinPicker needs from a map engine: move the pin, hide it, and report clicks/drags. */
type Engine = { show: (p: { lat: number; lng: number }, zoomIn: boolean) => void; hide: () => void; destroy: () => void }
type Pt = { lat: number; lng: number }

async function googleEngine(host: HTMLElement, start: Pt | null, onPick: (p: Pt) => void): Promise<Engine> {
  const maps = await loadGoogleMaps()
  const el = document.createElement('div')
  el.style.cssText = 'width:100%;height:100%'
  host.replaceChildren(el)
  const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')])
  reportUsage('google', 'maps_js')
  const map = new Map(el, { center: start ?? DHAKA, zoom: start ? 17 : 12, mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: 'greedy', clickableIcons: false })
  const marker = new AdvancedMarkerElement({ map: start ? map : null, position: start ?? DHAKA, gmpDraggable: true, title: 'Patient location' })
  marker.addListener('dragend', () => {
    const p = point(marker.position)
    if (p) onPick(p)
  })
  map.addListener('click', (e: any) => {
    const p = point(e.latLng)
    if (p) onPick(p)
  })
  return {
    show: (p, zoomIn) => {
      marker.position = p
      marker.map = map
      map.panTo(p)
      if (zoomIn && map.getZoom() < 15) map.setZoom(17)
    },
    hide: () => (marker.map = null),
    destroy: () => {},
  }
}

async function leafletEngine(host: HTMLElement, start: Pt | null, onPick: (p: Pt) => void): Promise<Engine> {
  const L = (await import('leaflet')).default
  const el = document.createElement('div')
  el.style.cssText = 'width:100%;height:100%'
  host.replaceChildren(el)
  reportUsage('osm', 'osm_map')
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(start ?? DHAKA, start ? 17 : 12)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' }).addTo(map)
  const icon = L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    html: '<div style="width:26px;height:26px;background:#0090CA;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff"></div>',
  })
  const marker = L.marker(start ?? DHAKA, { draggable: true, icon, title: 'Patient location' })
  if (start) marker.addTo(map)
  marker.on('dragend', () => onPick(marker.getLatLng()))
  map.on('click', (e: any) => onPick(e.latlng))
  return {
    show: (p, zoomIn) => {
      marker.setLatLng(p)
      if (!map.hasLayer(marker)) marker.addTo(map)
      map.setView(p, zoomIn && map.getZoom() < 15 ? 17 : map.getZoom())
    },
    hide: () => marker.remove(),
    destroy: () => map.remove(),
  }
}

/** Map with one draggable pin. Click or drag to place it; "My location" uses the device GPS. */
type PinLabels = { tap: string; none: string; set: string; myLocation: string; clear: string }
const PIN_EN: PinLabels = { tap: 'Tap the map to drop a pin', none: 'No pin yet — staff will navigate by address', set: 'Pinned', myLocation: 'My location', clear: 'Clear pin' }

export function PinPicker({ lat, lng, onChange, height = 260, labels = PIN_EN }: { lat?: number | null; lng?: number | null; onChange: (p: Pt | null) => void; height?: number; labels?: PinLabels }) {
  const el = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  const [err, setErr] = useState('')
  const [locating, setLocating] = useState(false)
  const has = lat != null && lng != null

  const [osm, setOsm] = useState(googleOff) // re-renders onto Leaflet when Google gives up
  const where = useRef<Pt | null>(has ? { lat: lat!, lng: lng! } : null)
  where.current = has ? { lat: lat!, lng: lng! } : null

  useEffect(() => {
    const onFallback = () => setOsm(true)
    window.addEventListener(FALLBACK_EVENT, onFallback)
    return () => window.removeEventListener(FALLBACK_EVENT, onFallback)
  }, [])

  useEffect(() => {
    let dead = false
    const host = el.current!
    host.innerHTML = '' // a fresh container when swapping Google → Leaflet
    const pick = (p: Pt) => change.current({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })
    const make = (async () =>
      !osm && (await googleUsable()) ? googleEngine(host, where.current, pick).catch(() => (dropGoogle(), leafletEngine(host, where.current, pick))) : leafletEngine(host, where.current, pick))()
    make.then((e) => (dead ? e.destroy() : (engine.current = e))).catch((e) => !dead && setErr(e.message))
    return () => {
      dead = true
      engine.current?.destroy()
      engine.current = null
    }
  }, [osm])

  // follow coordinates chosen by click/drag, address search, GPS or "clear"
  useEffect(() => {
    if (!engine.current) return
    if (has) engine.current.show({ lat: lat!, lng: lng! }, true)
    else engine.current.hide()
  }, [lat, lng, has])

  function locate() {
    if (!('geolocation' in navigator)) return setErr('This device does not share location')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        change.current({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      (e) => {
        setLocating(false)
        setErr(e.code === 1 ? 'Location permission denied' : 'Could not get a GPS fix')
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  return (
    <div>
      <div className="relative isolate overflow-hidden rounded-card border border-slate-200 bg-[#E5EEF2]" style={{ height }}>
        <div ref={el} className="size-full" />
        {err && <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/80 p-4 text-center text-[13px] text-slate-500">{err}</div>}
        {!err && !has && <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-[12px] font-semibold text-slate-600 shadow-sm">{labels.tap}</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-slate-500">
        <span className={cx('inline-flex items-center gap-1', has && 'font-semibold text-[#15803D]')}>
          <MapPin size={14} /> {has ? `${labels.set} ${lat!.toFixed(5)}, ${lng!.toFixed(5)}` : labels.none}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={locate} disabled={locating} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 font-semibold text-slate-700 hover:bg-slate-50">
          {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} {labels.myLocation}
        </button>
        {has && (
          <button type="button" onClick={() => change.current(null)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 font-semibold text-slate-500 hover:text-[#B91C1C]">
            <X size={14} /> {labels.clear}
          </button>
        )}
      </div>
    </div>
  )
}
