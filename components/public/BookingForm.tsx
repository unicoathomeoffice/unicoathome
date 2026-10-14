'use client'
// Public "book a home visit" form — phone first: one column, 48px+ targets, 16px inputs (no iOS zoom), sticky send bar.
// English / বাংলা via useLang(); slots come live from Settings → Online booking and grey out as visits are confirmed.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, CheckCircle2, Crosshair, Loader2, MapPin, Phone, Send } from 'lucide-react'
import { api } from '@/components/client/api'
import { AddressSearchInput, PinPicker, reverseGeocode } from '@/components/client/maps'
import { btnClass, telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { useLang, type Lang } from './i18n'

type Service = { code: string; name: string; category: string }
type Errors = Record<string, string>
type SlotState = 'open' | 'full' | 'past' | 'blocked' | 'closed'
export type BookingDay = { date: string; weekday: number; closed: boolean; slots: { start: string; end: string; label: string; booked: number; capacity: number; state: SlotState }[] }

const dhakaDay = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() + offset * 86400_000))
const loc = (lang: Lang) => (lang === 'bn' ? 'bn-BD' : 'en-GB')
const noon = (iso: string) => new Date(`${iso}T12:00:00+06:00`)
const fmtDay = (iso: string, lang: Lang, o: Intl.DateTimeFormatOptions) => noon(iso).toLocaleDateString(loc(lang), { timeZone: 'Asia/Dhaka', ...o })
const fmtTime = (hm: string, lang: Lang) => new Date(`2000-01-01T${hm}:00+06:00`).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
/** "09–11" style legacy slots (booking switched off) → readable */
const legacySlot = (s: string, lang: Lang) => {
  const [a, b] = s.split(/[–-]/).map((h) => h.trim())
  const hm = (x: string) => (x.includes(':') ? x : `${x.padStart(2, '0')}:00`)
  return a && b ? `${fmtTime(hm(a), lang)} – ${fmtTime(hm(b), lang)}` : s
}

const input = 'hc-input hc-input-lg !text-[16px]'
const blank = { name: '', phone: '', ageYears: '', gender: '' as '' | 'M' | 'F' | 'O', email: '', house: '', flat: '', road: '', area: '', landmark: '', lat: null as number | null, lng: null as number | null, serviceCodes: [] as string[], date: '', slot: '', notes: '', website: '' }

export function BookingForm({ services, zones, booking, legacySlots, hotline, hours }: { services: Service[]; zones: string[]; booking: { enabled: boolean; days: BookingDay[] }; legacySlots: string[]; hotline: string; hours: string }) {
  const { t, lang } = useLang()
  const [days, setDays] = useState<BookingDay[]>(booking.days)
  const firstOpen = (list: BookingDay[]) => list.find((d) => d.slots.some((s) => s.state === 'open'))?.date ?? list[0]?.date ?? dhakaDay(0)
  const [f, setF] = useState(() => ({ ...blank, date: booking.enabled ? firstOpen(booking.days) : dhakaDay(0) }))
  const [errors, setErrors] = useState<Errors>({})
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [done, setDone] = useState<{ requestNo: string; callWithinMin: number } | null>(null)
  // which boxes were filled for the patient (shown with a tag, and sent so the admin can tell typed from detected)
  const [auto, setAuto] = useState<string[]>([])
  const [source, setSource] = useState<{ kind: 'typed' | 'gps' | 'search' | 'pin'; accuracyM?: number }>({ kind: 'typed' })
  const addressRef = useRef<HTMLDivElement>(null)
  const autoTried = useRef(false)
  const plainDays = useMemo(() => Array.from({ length: 14 }, (_, i) => dhakaDay(i)), [])
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest)
    setAuto((a) => (a.includes(k) ? a.filter((x) => x !== k) : a)) // edited by hand → no longer auto-filled
  }
  const tag = (k: string) => (auto.includes(k) ? t.autoTag : undefined)

  // ---- live availability: refresh every 2 min and when the tab comes back into view
  const refresh = useCallback(async () => {
    if (!booking.enabled) return
    try {
      const r = await api<{ days: BookingDay[] }>('/public/availability')
      setDays(r.days)
      setF((x) => {
        const day = r.days.find((d) => d.date === x.date)
        const stillOpen = day?.slots.some((s) => s.label === x.slot && s.state === 'open')
        return { ...x, date: day ? x.date : firstOpen(r.days), slot: stillOpen ? x.slot : '' }
      })
    } catch {}
  }, [booking.enabled])
  useEffect(() => {
    if (!booking.enabled) return
    const id = setInterval(refresh, 120_000)
    const onVis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVis)
    return () => (clearInterval(id), document.removeEventListener('visibilitychange', onVis))
  }, [booking.enabled, refresh])

  // ---- auto-detect location when the Address section comes into view (or at once if already allowed)
  useEffect(() => {
    if (!('geolocation' in navigator) || !addressRef.current) return
    const go = () => {
      if (autoTried.current) return
      autoTried.current = true
      useMyLocation(true)
    }
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((st) => (st.state === 'granted' ? go() : null))
      .catch(() => {})
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && go(), { threshold: 0.35 })
    io.observe(addressRef.current)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function useMyLocation(silent = false) {
    if (!('geolocation' in navigator)) return silent ? undefined : setErrors((e) => ({ ...e, road: t.eLocNone }))
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = Math.round(p.coords.latitude * 1e6) / 1e6
        const lng = Math.round(p.coords.longitude * 1e6) / 1e6
        const place = await reverseGeocode(lat, lng)
        const zone = place?.area ? zones.find((z) => z.toLowerCase().includes(place.area.toLowerCase()) || place.area.toLowerCase().includes(z.toLowerCase())) : undefined
        const filled: string[] = []
        setF((x) => {
          // only fill boxes that are empty or were auto-filled before — never overwrite what the patient typed
          const may = (k: string, cur: string) => !cur.trim() || auto.includes(k)
          const next = { ...x, lat, lng }
          if (place?.road && may('road', x.road)) (next.road = place.road), filled.push('road')
          if ((zone || place?.area) && may('area', x.area)) (next.area = zone || place!.area), filled.push('area')
          if (place?.landmark && may('landmark', x.landmark)) (next.landmark = place.landmark), filled.push('landmark')
          return next
        })
        setAuto((a) => [...new Set([...a, ...filled])])
        setSource({ kind: 'gps', accuracyM: Math.round(p.coords.accuracy) })
        setErrors(({ road: _, ...rest }) => rest)
        setLocating(false)
      },
      (e) => {
        setLocating(false)
        if (silent) return // silent when we asked on our own — the button and typing still work
        setErrors((x) => ({ ...x, road: e.code === 1 ? t.eLocBlocked : t.eLocFail }))
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  function validate() {
    const e: Errors = {}
    if (f.name.trim().length < 2) e.name = t.eName
    if (!/^(?:880|0)?1[3-9]\d{8}$/.test(f.phone.replace(/\D/g, ''))) e.phone = t.ePhone
    if (f.ageYears === '' || Number(f.ageYears) > 120) e.ageYears = t.eAge
    if (!f.gender) e.gender = t.eGender
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = t.eEmail
    if (!f.house.trim()) e.house = t.eRequired
    if (!f.flat.trim()) e.flat = t.eRequired
    if (f.road.trim().length < 3) e.road = t.eRoad
    if (!f.serviceCodes.length) e.serviceCodes = t.eService
    if (!f.slot) e.slot = t.eSlot
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) document.getElementById(`f-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return !first
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setFormErr('')
    if (!validate()) return
    setBusy(true)
    try {
      const r = await api<{ requestNo: string; callWithinMin: number }>('/public/requests', {
        body: {
          ...f,
          ageYears: Number(f.ageYears),
          lat: f.lat ?? undefined,
          lng: f.lng ?? undefined,
          area: f.area || undefined,
          landmark: f.landmark || undefined,
          notes: f.notes || undefined,
          intake: { locationSource: f.lat == null ? 'typed' : source.kind, accuracyM: source.kind === 'gps' ? source.accuracyM : undefined, autoFields: auto },
        },
      })
      setDone(r)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) {
      if (e.code === 'SLOT_TAKEN') {
        setErrors({ slot: t.eTaken })
        setFormErr(t.eTaken)
        await refresh()
        document.getElementById('f-slot')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        if (e.fields) setErrors(Object.fromEntries(Object.entries(e.fields as Errors).map(([k, v]) => [k.split('.')[0], v])))
        setFormErr(e.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <div className="mt-6 rounded-card bg-white p-6 text-center shadow-card">
        <CheckCircle2 size={56} className="mx-auto text-[#16A34A]" />
        <h2 className="mt-3 text-[22px] font-bold">{t.sent}</h2>
        <div className="mt-1 text-[15px] text-slate-600">{t.yourNo}</div>
        <div className="mt-1 text-[26px] font-bold tracking-wide text-navy">{done.requestNo}</div>
        <p className="mx-auto mt-3 max-w-[420px] text-[15px] leading-[24px] text-slate-600">
          {t.willCall(f.phone, done.callWithinMin || 15, hours)}
          {f.email && ` ${t.emailed}`}
        </p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <a href={telUrl(hotline)} className={btnClass('o', 'xl', 'w-full')}>
            <Phone size={18} /> {t.call} {hotline}
          </a>
          <button type="button" onClick={() => (setF({ ...blank, date: booking.enabled ? firstOpen(days) : dhakaDay(0) }), setAuto([]), setSource({ kind: 'typed' }), setDone(null), refresh())} className={btnClass('p', 'xl', 'w-full')}>
            {t.another}
          </button>
        </div>
      </div>
    )

  // ---- day + slot data (live booking grid, or the legacy fixed slot list)
  const dayList = booking.enabled ? days.map((d) => ({ date: d.date, open: d.slots.some((s) => s.state === 'open'), closed: d.closed })) : plainDays.map((d) => ({ date: d, open: true, closed: false }))
  const today = dhakaDay(0)
  const tomorrow = dhakaDay(1)
  const selected = days.find((d) => d.date === f.date)
  const slotList = booking.enabled
    ? (selected?.slots ?? []).map((s) => ({ value: s.label, label: `${fmtTime(s.start, lang)} – ${fmtTime(s.end, lang)}`, state: s.state }))
    : legacySlots.map((s) => ({ value: s, label: legacySlot(s, lang), state: 'open' as SlotState }))
  const stateText: Record<SlotState, string> = { open: '', full: t.booked, past: t.unavailable, blocked: t.unavailable, closed: t.closed }

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
      {/* honeypot: hidden from people, irresistible to bots */}
      <input type="text" name="website" value={f.website} onChange={(e) => set('website', e.target.value)} tabIndex={-1} autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />

      <Section n={1} title={t.sPatient}>
        <Field id="name" label={t.name} error={errors.name}>
          <input id="f-name" className={input} value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" placeholder={t.namePh} />
        </Field>
        <Field id="phone" label={t.phone} error={errors.phone}>
          <input id="f-phone" className={input} value={f.phone} onChange={(e) => set('phone', e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" />
        </Field>
        <div className="grid grid-cols-[104px_1fr] gap-3">
          <Field id="ageYears" label={t.age} error={errors.ageYears}>
            <input id="f-ageYears" className={input} value={f.ageYears} onChange={(e) => set('ageYears', e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder={t.agePh} />
          </Field>
          <Field id="gender" label={t.gender} error={errors.gender}>
            <div id="f-gender" className="grid h-12 grid-cols-3 gap-1 rounded-lg bg-slate-200 p-1">
              {(
                [
                  ['M', t.male],
                  ['F', t.female],
                  ['O', t.other],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" onClick={() => set('gender', v)} aria-pressed={f.gender === v} className={cx('rounded-md text-[14px] font-semibold', f.gender === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field id="email" label={t.email} hint={t.emailHint} error={errors.email}>
          <input id="f-email" className={input} value={f.email} onChange={(e) => set('email', e.target.value)} type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" />
        </Field>
      </Section>

      <Section n={2} title={t.sAddress} innerRef={addressRef}>
        <button type="button" onClick={() => useMyLocation()} disabled={locating} className={cx('flex h-[52px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] px-3 text-[15px] font-semibold', f.lat != null ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]' : 'border-primary/40 bg-primary-50 text-primary-700')}>
          {locating ? <Loader2 size={18} className="animate-spin" /> : f.lat != null ? <Check size={18} /> : <Crosshair size={18} />}
          {locating ? t.locating : f.lat != null ? t.located : t.useLocation}
        </button>
        <Field id="road" label={t.road} hint={t.roadHint} error={errors.road} tag={tag('road')}>
          <div id="f-road">
            <AddressSearchInput
              className={input}
              value={f.road}
              onChange={(v) => set('road', v)}
              onPlace={(p) => (setF((x) => ({ ...x, road: p.full, lat: p.lat, lng: p.lng })), setAuto((a) => [...new Set([...a, 'road'])]), setSource({ kind: 'search' }), setErrors(({ road: _, ...r }) => r))}
              placeholder={t.roadPh}
            />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="house" label={t.house} error={errors.house}>
            <input id="f-house" className={input} value={f.house} onChange={(e) => set('house', e.target.value)} placeholder={t.housePh} />
          </Field>
          <Field id="flat" label={t.flat} error={errors.flat}>
            <input id="f-flat" className={input} value={f.flat} onChange={(e) => set('flat', e.target.value)} placeholder={t.flatPh} />
          </Field>
        </div>
        <Field id="area" label={t.area} tag={tag('area')}>
          <input id="f-area" className={input} value={f.area} onChange={(e) => set('area', e.target.value)} list="hc-zones" placeholder={t.areaPh} autoComplete="off" />
          <datalist id="hc-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field id="landmark" label={t.landmark} tag={tag('landmark')}>
          <input id="f-landmark" className={input} value={f.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder={t.landmarkPh} />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-700">
            <MapPin size={15} /> {t.onMap}
          </div>
          <PinPicker
            height={260}
            lat={f.lat}
            lng={f.lng}
            onChange={(p) => (setF((x) => ({ ...x, lat: p?.lat ?? null, lng: p?.lng ?? null })), setSource(p ? { kind: 'pin' } : { kind: 'typed' }))}
            labels={{ tap: t.pinTap, none: t.pinNone, set: t.pinSet, myLocation: t.myLocation, clear: t.clearPin }}
          />
          <div className="mt-1 text-[12.5px] text-slate-500">{t.mapHint}</div>
        </div>
      </Section>

      <Section n={3} title={t.sService}>
        <div id="f-serviceCodes" className="flex flex-wrap gap-2">
          {services.map((s) => {
            const on = f.serviceCodes.includes(s.code)
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => set('serviceCodes', on ? f.serviceCodes.filter((c) => c !== s.code) : [...f.serviceCodes, s.code])}
                className={cx('flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] px-4 py-2 text-left text-[14.5px] font-semibold', on ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-700')}
                aria-pressed={on}
              >
                {on && <Check size={16} />} {s.name}
              </button>
            )
          })}
          {!services.length && <div className="text-[14px] text-slate-500">{t.callUs(hotline)}</div>}
        </div>
        {errors.serviceCodes && <Err>{errors.serviceCodes}</Err>}
      </Section>

      <Section n={4} title={t.sWhen}>
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 no-scrollbar" role="radiogroup" aria-label={t.sWhen}>
          {dayList.map((d) => {
            const on = f.date === d.date
            const top = d.date === today ? t.today : d.date === tomorrow ? t.tomorrow : fmtDay(d.date, lang, { weekday: 'short' })
            const off = !d.open
            return (
              <button
                key={d.date}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => (setF((x) => ({ ...x, date: d.date, slot: '' })), setErrors(({ slot: _, ...r }) => r))}
                className={cx('flex h-[64px] w-[76px] flex-none snap-start flex-col items-center justify-center rounded-xl border-[1.5px] text-[12.5px] leading-tight', on ? 'border-primary bg-primary text-white' : off ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-300 bg-white text-slate-600')}
              >
                <span className="font-semibold">{top}</span>
                <span className={cx('text-[14px] font-bold', on ? 'text-white' : off ? 'text-slate-400' : 'text-slate-900')}>{fmtDay(d.date, lang, { day: 'numeric', month: 'short' })}</span>
                {off && <span className={cx('text-[10.5px] font-semibold', on ? 'text-white/80' : 'text-[#B45309]')}>{d.closed ? t.closed : t.full}</span>}
              </button>
            )
          })}
        </div>
        <div id="f-slot" className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.sWhen}>
          {slotList.map((s) => {
            const on = f.slot === s.value
            const open = s.state === 'open'
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!open}
                onClick={() => set('slot', s.value)}
                className={cx('flex h-[52px] flex-col items-center justify-center rounded-lg border-[1.5px] text-[14.5px] font-semibold leading-tight', on ? 'border-primary bg-primary-50 text-primary-700' : open ? 'border-slate-300 bg-white text-slate-700' : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 line-through decoration-slate-300')}
              >
                {s.label}
                {!open && <span className="text-[10.5px] font-semibold no-underline">{stateText[s.state]}</span>}
              </button>
            )
          })}
        </div>
        {booking.enabled && selected && !selected.slots.some((s) => s.state === 'open') && <div className="rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13.5px] text-[#92400E]">{t.noSlots}</div>}
        {errors.slot && <Err>{errors.slot}</Err>}
        <p className="text-[13px] text-slate-500">{t.confirmByPhone}</p>
      </Section>

      <Section n={5} title={t.sMore}>
        <textarea id="f-notes" className="hc-input !text-[16px]" rows={4} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t.notesPh} />
      </Section>

      {formErr && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-[#FEE2E2] px-3.5 py-3 text-[14px] text-[#B91C1C]">
          <AlertTriangle size={18} className="mt-px flex-none" /> {formErr}
        </div>
      )}
      <p className="text-[12.5px] leading-[20px] text-slate-500">
        {t.consent1}{' '}
        <Link href="/privacy" className="underline">
          {t.privacy}
        </Link>
        . {t.consent2}
      </p>

      {/* sticky on phones, inline on larger screens */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" disabled={busy} className={btnClass('p', 'xl', 'mx-auto w-full max-w-[720px]')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? t.sending : t.send}
        </button>
      </div>
    </form>
  )
}

function Section({ n, title, children, innerRef }: { n: number; title: string; children: ReactNode; innerRef?: React.Ref<HTMLDivElement> }) {
  return (
    <section ref={innerRef} className="rounded-card bg-white p-4 shadow-card sm:p-5">
      <h2 className="mb-3.5 flex items-center gap-2.5 text-[16px] font-bold text-slate-900">
        <span className="flex size-7 flex-none items-center justify-center rounded-full bg-primary-50 text-[13px] text-primary-700">{n}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  )
}

function Field({ id, label, hint, error, tag, children }: { id: string; label: string; hint?: string; error?: string; tag?: string; children: ReactNode }) {
  return (
    <div className={cx(error && '[&_.hc-input]:border-[#DC2626]', tag && !error && '[&_.hc-input]:border-[#86EFAC] [&_.hc-input]:bg-[#F0FDF4]')}>
      <label htmlFor={`f-${id}`} className="hc-label flex items-center gap-2 !text-[13.5px]">
        {label}
        {tag && <span className="rounded-full bg-[#DCFCE7] px-2 py-px text-[11px] font-semibold text-[#15803D]">✓ {tag}</span>}
      </label>
      {children}
      {error ? <Err>{error}</Err> : hint && <div className="mt-1 text-[12.5px] text-slate-500">{hint}</div>}
    </div>
  )
}

const Err = ({ children }: { children: ReactNode }) => <div className="mt-1 text-[13px] font-medium text-[#B91C1C]">{children}</div>
