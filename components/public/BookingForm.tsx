'use client'
// Public "book a home visit" form — phone first: one column, 48px+ targets, 16px inputs (no iOS zoom), sticky send bar.
// English / বাংলা via useLang(); slots come live from Settings → Online booking and grey out as visits are confirmed.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, CheckCircle2, FileText, ImagePlus, Loader2, Phone, Send, X } from 'lucide-react'
import { api } from '@/components/client/api'
import { compressImage } from '@/components/client'
import { AddressBlock, type AddressMeta, type AddressValue } from '@/components/client/AddressBlock'
import { btnClass, telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { useLang, type Lang } from './i18n'

type Service = { code: string; name: string; category: string; requiresPrescription?: boolean }
type Errors = Record<string, string>
type SlotState = 'open' | 'full' | 'past' | 'blocked' | 'closed'
export type BookingDay = { date: string; weekday: number; closed: boolean; slots: { start: string; end: string; label: string; booked: number; capacity: number; state: SlotState }[] }
type Doc = { uid: number; name: string; kind: 'image' | 'pdf'; preview?: string; busy: boolean; id?: string; token?: string; err?: string }
let docSeq = 1

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
export type BookingPrefill = Partial<Pick<typeof blank, 'name' | 'phone' | 'ageYears' | 'gender' | 'email' | 'house' | 'flat' | 'road' | 'area' | 'landmark' | 'lat' | 'lng'>>
const blank = { name: '', phone: '', ageYears: '', gender: '' as '' | 'M' | 'F' | 'O', email: '', house: '', flat: '', road: '', area: '', landmark: '', lat: null as number | null, lng: null as number | null, serviceCodes: [] as string[], date: '', slot: '', notes: '', website: '' }

export function BookingForm({ services, zones, booking, legacySlots, hotline, hours, prefill, signedIn }: { services: Service[]; zones: string[]; booking: { enabled: boolean; days: BookingDay[] }; legacySlots: string[]; hotline: string; hours: string; prefill?: BookingPrefill; signedIn?: boolean }) {
  const { t, lang } = useLang()
  const [days, setDays] = useState<BookingDay[]>(booking.days)
  const firstOpen = (list: BookingDay[]) => list.find((d) => d.slots.some((s) => s.state === 'open'))?.date ?? list[0]?.date ?? dhakaDay(0)
  const [f, setF] = useState(() => ({ ...blank, ...prefill, date: booking.enabled ? firstOpen(booking.days) : dhakaDay(0) }))
  const [errors, setErrors] = useState<Errors>({})
  const [formErr, setFormErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ requestNo: string; callWithinMin: number } | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [addrMeta, setAddrMeta] = useState<AddressMeta>({ source: 'typed', autoFields: [] })
  const rxNeeded = services.filter((s) => s.requiresPrescription && f.serviceCodes.includes(s.code))
  const plainDays = useMemo(() => Array.from({ length: 14 }, (_, i) => dhakaDay(i)), [])
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest)
  }
  const setAddr = (patch: Partial<AddressValue>) => {
    setF((x) => ({ ...x, ...patch }))
    setErrors((e) => {
      const n = { ...e }
      for (const k of Object.keys(patch)) delete n[k]
      return n
    })
  }

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

  async function addFiles(list: FileList | null) {
    if (!list) return
    const room = 3 - docs.length
    for (const file of Array.from(list).slice(0, Math.max(0, room))) {
      const isPdf = file.type === 'application/pdf'
      const uid = docSeq++
      if (!isPdf && !/^image\//.test(file.type)) {
        setDocs((d) => [...d, { uid, name: file.name, kind: 'image', busy: false, err: t.eFileType }])
        continue
      }
      if (file.size > 25 * 1024 * 1024) {
        setDocs((d) => [...d, { uid, name: file.name, kind: isPdf ? 'pdf' : 'image', busy: false, err: t.eFileBig }])
        continue
      }
      const preview = isPdf ? undefined : URL.createObjectURL(file)
      setDocs((d) => [...d, { uid, name: file.name, kind: isPdf ? 'pdf' : 'image', preview, busy: true }])
      try {
        const form = new FormData()
        form.append('file', isPdf ? file : await compressImage(file, false))
        const r = await api<{ id: string; token: string }>('/public/uploads', { form })
        setDocs((d) => d.map((x) => (x.uid === uid ? { ...x, busy: false, id: r.id, token: r.token } : x)))
        setErrors(({ attachments: _, ...rest }) => rest)
      } catch (e: any) {
        setDocs((d) => d.map((x) => (x.uid === uid ? { ...x, busy: false, err: e.message } : x)))
      }
    }
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
    if (rxNeeded.length && !docs.some((d) => d.id)) e.attachments = t.eDocs
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
          intake: { locationSource: f.lat == null ? 'typed' : addrMeta.source, accuracyM: addrMeta.source === 'gps' ? addrMeta.accuracyM : undefined, autoFields: addrMeta.autoFields },
          attachments: docs.filter((d) => d.id && d.token).map((d) => ({ id: d.id, token: d.token })),
        },
      })
      setDone(r)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) {
      if (e.code === 'PRESCRIPTION_REQUIRED') {
        setErrors({ attachments: t.eDocs })
        setFormErr(e.message)
        document.getElementById('f-attachments')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else if (e.code === 'SLOT_TAKEN') {
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
          {signedIn ? (
            <Link href="/my" className={btnClass('o', 'xl', 'w-full')}>
              {t.ctaMy}
            </Link>
          ) : (
            <a href={telUrl(hotline)} className={btnClass('o', 'xl', 'w-full')}>
              <Phone size={18} /> {t.call} {hotline}
            </a>
          )}
          <button type="button" onClick={() => (setF({ ...blank, ...prefill, date: booking.enabled ? firstOpen(days) : dhakaDay(0) }), setDocs([]), setDone(null), refresh())} className={btnClass('p', 'xl', 'w-full')}>
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

      <Section n={2} title={t.sAddress}>
        <AddressBlock
          value={{ road: f.road, house: f.house, flat: f.flat, area: f.area, landmark: f.landmark, lat: f.lat, lng: f.lng }}
          onChange={setAddr}
          onMeta={setAddrMeta}
          zones={zones}
          errors={errors}
          autoDetect
          labels={{
            useLocation: t.useLocation,
            locating: t.locating,
            located: t.located,
            autoTag: t.autoTag,
            road: t.road,
            roadHint: t.roadHint,
            roadPh: t.roadPh,
            house: t.house,
            housePh: t.housePh,
            flat: t.flat,
            flatPh: t.flatPh,
            area: t.area,
            areaPh: t.areaPh,
            landmark: t.landmark,
            landmarkPh: t.landmarkPh,
            onMap: t.onMap,
            mapHint: t.mapHint,
            pinTap: t.pinTap,
            pinNone: t.pinNone,
            pinSet: t.pinSet,
            myLocation: t.myLocation,
            clearPin: t.clearPin,
            accGood: t.accGood,
            accPoor: t.accPoor,
            accBad: t.accBad,
            eLocBlocked: t.eLocBlocked,
            eLocFail: t.eLocFail,
            eLocNone: t.eLocNone,
          }}
        />
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

      <Section n={5} title={t.sDocs}>
        <div id="f-attachments" className={cx('rounded-xl border-[1.5px] border-dashed p-3', errors.attachments ? 'border-[#DC2626] bg-[#FEF2F2]' : rxNeeded.length ? 'border-[#F59E0B] bg-[#FFFBEB]' : 'border-slate-300 bg-slate-50')}>
          {rxNeeded.length > 0 && (
            <div className="mb-2 text-[13.5px] font-semibold text-[#B45309]">
              {t.docsRequired} {rxNeeded.map((s) => s.name).join(', ')}
            </div>
          )}
          <p className="text-[12.5px] text-slate-500">{t.docsHint}</p>
          {docs.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {docs.map((d) => (
                <li key={d.uid} className="flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-slate-200">
                  {d.preview ? (
                    <img src={d.preview} alt="" className="size-12 flex-none rounded-md object-cover" />
                  ) : (
                    <span className="flex size-12 flex-none items-center justify-center rounded-md bg-slate-100 text-slate-500">
                      <FileText size={22} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{d.name}</span>
                    <span className={cx('block text-[12px]', d.err ? 'text-[#B91C1C]' : d.busy ? 'text-slate-500' : 'text-[#15803D]')}>{d.err ? d.err : d.busy ? t.uploading : '✓'}</span>
                  </span>
                  {d.busy ? (
                    <Loader2 size={18} className="animate-spin text-slate-400" />
                  ) : (
                    <button type="button" onClick={() => setDocs((x) => x.filter((y) => y.uid !== d.uid))} className="flex size-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-[#B91C1C]" aria-label={t.remove}>
                      <X size={17} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {docs.length < 3 && (
            <label className="mt-3 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-slate-300 bg-white text-[14.5px] font-semibold text-primary-700 hover:bg-primary-50">
              <ImagePlus size={18} /> {t.addPhoto}
              <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
            </label>
          )}
        </div>
        {errors.attachments && <Err>{errors.attachments}</Err>}
      </Section>

      <Section n={6} title={t.sMore}>
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

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-white p-4 shadow-card sm:p-5">
      <h2 className="mb-3.5 flex items-center gap-2.5 text-[16px] font-bold text-slate-900">
        <span className="flex size-7 flex-none items-center justify-center rounded-full bg-primary-50 text-[13px] text-primary-700">{n}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className={cx(error && '[&_.hc-input]:border-[#DC2626]')}>
      <label htmlFor={`f-${id}`} className="hc-label !text-[13.5px]">
        {label}
      </label>
      {children}
      {error ? <Err>{error}</Err> : hint && <div className="mt-1 text-[12.5px] text-slate-500">{hint}</div>}
    </div>
  )
}

const Err = ({ children }: { children: ReactNode }) => <div className="mt-1 text-[13px] font-medium text-[#B91C1C]">{children}</div>
