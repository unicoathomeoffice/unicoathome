'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, MapPin, Plus, Search, X } from 'lucide-react'
import { btnClass, StatusChip } from '@/components/ui'
import { api, ChipPicker, Segmented, Toggle, useToast } from '@/components/client'
import { ACTIVE_STATUSES, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, REQUEST_SOURCES, TESTS_PROCEDURES, type Status } from '@/lib/constants'
import { ageGender, cx, dayNum, initialsOf, phone as fmtPhone, taka, time as fmtTime } from '@/lib/format'

export type FormPatient = {
  _id: string
  name: string
  phone: string
  ageYears?: number
  gender?: string
  uhid?: string
  email?: string
  address?: { area?: string; full?: string; landmark?: string }
  allergies?: string[]
  latest?: { requestId: string; requestNo: string; status: string; scheduledAt?: string; count: number } | null
}
type Service = { code: string; name: string; category: string; fee: number; duration: number }

const SOURCE_LABEL: Record<string, string> = { PHONE: 'Phone call', WALK_IN: 'Walk-in', WHATSAPP: 'WhatsApp', WEBSITE: 'Website', APP: 'App' }
const DRAFT_KEY = 'hc:new-request-draft'

const blank = (today: string) => ({
  mode: 'existing' as 'existing' | 'new',
  patient: null as FormPatient | null,
  np: { name: '', phone: '', altPhone: '', ageYears: '', gender: '' as '' | 'M' | 'F' | 'O', uhid: '', email: '' },
  addr: { area: '', full: '', landmark: '' },
  requester: { type: 'SELF' as 'SELF' | 'RELATIVE', name: '', relation: '', phone: '' },
  serviceCodes: [] as string[],
  otherService: '',
  tests: [] as string[],
  priority: 'ROUTINE' as 'ROUTINE' | 'URGENT' | 'EMERGENCY',
  date: today,
  timeMode: 'slot' as 'slot' | 'time',
  slot: '',
  time: '',
  duration: '',
  transport: false,
  complaint: '',
  notes: '',
  refDoctor: '',
  allergies: '',
  fee: '',
  payment: '' as '' | (typeof PAYMENT_METHODS)[number],
  source: 'PHONE' as (typeof REQUEST_SOURCES)[number],
  remarks: '',
})
type F = ReturnType<typeof blank>

const STEPS = [
  { n: 1, title: 'Patient & address', sub: 'Search or create' },
  { n: 2, title: 'Service & schedule', sub: 'Type, priority, slot' },
  { n: 3, title: 'Clinical & payment', sub: 'Complaint, fee, remarks' },
] as const

/** W05 — 3-step new request form. Creates the request (NEW), optionally confirms it and hands over to assignment. */
export function RequestForm({
  nextNo,
  today,
  slots,
  zones,
  services,
  initialPatient,
  canConfirm,
  canAssign,
}: {
  nextNo: string
  today: string
  slots: string[]
  zones: string[]
  services: Service[]
  initialPatient: FormPatient | null
  canConfirm: boolean
  canAssign: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [f, setF] = useState<F>(() => (initialPatient ? pickPatient(blank(today), initialPatient) : blank(today)))
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | 'save' | 'confirm' | 'assign'>(null)
  const [dup, setDup] = useState<{ message: string; requestNo?: string; kind: 'save' | 'confirm' | 'assign' } | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const restored = useRef(false)

  const set = <K extends keyof F>(k: K, v: F[K]) => setF((x) => ({ ...x, [k]: v }))
  const setIn = <K extends 'np' | 'addr' | 'requester'>(k: K, patch: Partial<F[K]>) => setF((x) => ({ ...x, [k]: { ...x[k], ...patch } }))

  // ---------------------------------------------------------------- draft autosave (per browser)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (initialPatient) return
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d?.f && Date.now() - new Date(d.at).getTime() < 24 * 3600_000) {
        setF({ ...blank(today), ...d.f, date: d.f.date && d.f.date >= today ? d.f.date : today })
        setSavedAt(new Date(d.at))
        toast('Restored your unsaved draft', 'info')
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!restored.current) return
    const empty = !f.patient && !f.np.name && !f.np.phone && !f.serviceCodes.length && !f.complaint
    const t = setTimeout(() => {
      try {
        if (empty) return localStorage.removeItem(DRAFT_KEY)
        const at = new Date()
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ at, f }))
        setSavedAt(at)
      } catch {}
    }, 800)
    return () => clearTimeout(t)
  }, [f])
  // each step starts at the top of the scrolling content area
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [step])
  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {}
    setF(blank(today))
    setSavedAt(null)
    setStep(1)
    setErrors({})
  }

  // ---------------------------------------------------------------- derived
  const chosen = services.filter((s) => f.serviceCodes.includes(s.code))
  const autoFee = chosen.reduce((a, s) => a + s.fee, 0)
  const autoDuration = chosen.length ? Math.max(30, ...chosen.map((s) => s.duration)) : 45
  const fee = f.fee === '' ? autoFee : Number(f.fee)

  function validate(upTo: 1 | 2 | 3, needDate = false) {
    const e: Record<string, string> = {}
    if (upTo >= 1) {
      if (f.mode === 'existing' && !f.patient) e.patient = 'Search and select a patient, or add a new patient'
      if (f.mode === 'new') {
        if (f.np.name.trim().length < 2) e.name = 'Enter the patient’s name'
        if (f.np.phone.replace(/\D/g, '').length < 6) e.phone = 'Enter a valid phone number'
        if (f.np.email && !/^\S+@\S+\.\S+$/.test(f.np.email)) e.email = 'Invalid email'
        if (f.np.ageYears && (Number(f.np.ageYears) < 0 || Number(f.np.ageYears) > 120)) e.ageYears = '0–120'
      }
      if (f.addr.full.trim().length < 3) e.full = 'Enter the address for this visit'
    }
    if (upTo >= 2) {
      if (!f.serviceCodes.length && !f.otherService.trim()) e.services = 'Pick at least one service'
      if (needDate && !f.date) e.date = 'Pick the date of service to confirm'
      if (f.timeMode === 'time' && f.time && !/^\d{2}:\d{2}$/.test(f.time)) e.time = 'Use HH:mm'
    }
    if (upTo >= 3 && f.fee !== '' && (isNaN(Number(f.fee)) || Number(f.fee) < 0)) e.fee = 'Enter a valid amount'
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) {
      const s = ['patient', 'name', 'phone', 'email', 'ageYears', 'full'].includes(first) ? 1 : ['services', 'date', 'time'].includes(first) ? 2 : 3
      setStep(s as 1 | 2 | 3)
      toast(e[first], 'err')
      return false
    }
    return true
  }

  function goTo(n: 1 | 2 | 3) {
    if (n <= step || validate((n - 1) as 1 | 2)) setStep(n)
  }

  async function submit(kind: 'save' | 'confirm' | 'assign', ignoreDuplicate = false) {
    if (!validate(3, kind !== 'save')) return
    setBusy(kind)
    setDup(null)
    try {
      // Existing patient with a changed address: update the patient record first (keeps address history)
      if (f.mode === 'existing' && f.patient) {
        const a = f.patient.address ?? {}
        if ((a.full ?? '') !== f.addr.full.trim() || (a.area ?? '') !== f.addr.area || (a.landmark ?? '') !== f.addr.landmark.trim())
          await api(`/patients/${f.patient._id}`, { method: 'PATCH', body: { address: { area: f.addr.area || undefined, full: f.addr.full.trim(), landmark: f.addr.landmark.trim() || undefined } } })
      }
      const slot = f.timeMode === 'slot' && f.slot ? f.slot : undefined
      const time = f.timeMode === 'time' && f.time ? f.time : undefined
      const body = {
        ...(f.mode === 'existing' && f.patient
          ? { patientId: f.patient._id }
          : {
              patient: {
                name: f.np.name.trim(),
                phone: f.np.phone.trim(),
                altPhone: f.np.altPhone.trim() || undefined,
                ageYears: f.np.ageYears === '' ? undefined : Number(f.np.ageYears),
                gender: f.np.gender || undefined,
                uhid: f.np.uhid.trim() || undefined,
                email: f.np.email.trim() || undefined,
                address: { area: f.addr.area || undefined, full: f.addr.full.trim(), landmark: f.addr.landmark.trim() || undefined },
              },
            }),
        requester: f.requester.type === 'RELATIVE' ? { type: 'RELATIVE', name: f.requester.name.trim() || undefined, relation: f.requester.relation.trim() || undefined, phone: f.requester.phone.trim() || undefined } : { type: 'SELF' },
        serviceCodes: f.serviceCodes,
        otherService: f.otherService.trim() || undefined,
        tests: f.tests,
        priority: f.priority,
        preferredDate: f.date || undefined,
        preferredSlot: slot,
        preferredTime: time,
        expectedDurationMin: f.duration ? Number(f.duration) : undefined,
        complaint: f.complaint.trim() || undefined,
        clinicalNotes: f.notes.trim() || undefined,
        referringDoctor: f.refDoctor.trim() || undefined,
        allergies: f.allergies.trim() ? f.allergies.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        estimatedFee: fee,
        paymentMethod: f.payment || undefined,
        transportNeeded: f.transport,
        source: f.source,
        remarks: f.remarks.trim() || undefined,
        ignoreDuplicate: ignoreDuplicate || undefined,
      }
      const r = await api<{ id: string; requestNo: string }>('/requests', { body })
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {}
      if (kind !== 'save') {
        try {
          await api(`/requests/${r.id}/confirm`, { body: { date: f.date, slot, time } })
        } catch (e: any) {
          toast(`${r.requestNo} saved, but not confirmed: ${e?.message ?? 'error'}`, 'err')
          router.push(`/requests/${r.id}`)
          return
        }
      }
      toast(kind === 'save' ? `${r.requestNo} created` : `${r.requestNo} created and confirmed`, 'ok')
      router.push(kind === 'assign' ? `/requests/${r.id}?assign=1` : `/requests/${r.id}`)
    } catch (e: any) {
      if (e?.code === 'DUPLICATE') setDup({ message: e.message, requestNo: e.fields?.requestNo, kind })
      else {
        if (e?.fields) setErrors(e.fields)
        toast(e?.message ?? 'Could not save the request', 'err')
      }
    } finally {
      setBusy(null)
    }
  }

  // ---------------------------------------------------------------- render
  return (
    <div className="flex min-h-full flex-col gap-6 lg:flex-row">
      {/* stepper */}
      <aside className="flex flex-none flex-col gap-1 lg:w-[240px]">
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {STEPS.map((s) => {
            const on = s.n === step
            const done = s.n < step
            return (
              <button key={s.n} type="button" onClick={() => goTo(s.n)} className={cx('flex flex-none gap-3 rounded-[10px] p-3 text-left', on ? 'bg-white shadow-card' : 'hover:bg-white/60')}>
                <span
                  className={cx(
                    'flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-bold',
                    on ? 'bg-primary text-white' : done ? 'bg-[#DCFCE7] text-[#15803D]' : 'border-2 border-slate-300 text-slate-500',
                  )}
                >
                  {done ? <Check size={15} strokeWidth={3} /> : s.n}
                </span>
                <span>
                  <span className={cx('block text-sm', on ? 'font-bold text-slate-900' : 'font-semibold text-slate-500')}>{s.title}</span>
                  <span className="block text-[12px] text-slate-400">{s.sub}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-auto hidden px-3 pt-6 text-[12px] leading-[18px] text-slate-400 lg:block">
          Request number is issued on save: <b className="text-slate-500">{nextNo}</b>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {step === 1 && <StepPatient f={f} set={set} setIn={setIn} zones={zones} errors={errors} />}
        {step === 2 && <StepService f={f} set={set} services={services} slots={slots} today={today} errors={errors} autoDuration={autoDuration} />}
        {step === 3 && <StepClinical f={f} set={set} services={chosen} autoFee={autoFee} fee={fee} errors={errors} />}

        {dup && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#B45309]" role="alert">
            <AlertTriangle size={16} className="flex-none" />
            <span className="min-w-0 flex-1">{dup.message}</span>
            {dup.requestNo && (
              <Link href={`/search?q=${encodeURIComponent(dup.requestNo)}`} className="font-bold hover:underline">
                Open {dup.requestNo}
              </Link>
            )}
            <button type="button" onClick={() => submit(dup.kind, true)} className="inline-flex h-8 items-center rounded-lg bg-[#B45309] px-3 text-[13px] font-semibold text-white hover:bg-[#92400E]">
              Create anyway
            </button>
            <button type="button" onClick={() => setDup(null)} aria-label="Dismiss" className="text-[#B45309]/70 hover:text-[#B45309]">
              <X size={16} />
            </button>
          </div>
        )}

        {/* footer */}
        <div className="sticky bottom-0 -mx-1 mt-auto flex flex-wrap items-center justify-between gap-3 bg-page px-1 py-3">
          <span className="text-[13px] text-slate-500">
            {savedAt ? (
              <>
                Draft autosaved {fmtTime(savedAt)} ·{' '}
                <button type="button" onClick={discardDraft} className="font-semibold text-slate-600 hover:underline">
                  Discard
                </button>
              </>
            ) : (
              <span className="lg:hidden">
                Request number on save: <b>{nextNo}</b>
              </span>
            )}
          </span>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/requests" className={btnClass('o')}>
              Cancel
            </Link>
            {step > 1 && (
              <button type="button" className={btnClass('o')} onClick={() => setStep((s) => (s - 1) as 1 | 2)}>
                <ChevronLeft size={16} /> Back
              </button>
            )}
            {step < 3 ? (
              <button type="button" className={btnClass('p')} onClick={() => goTo((step + 1) as 2 | 3)}>
                <ChevronRight size={16} /> Next · {STEPS[step as 1 | 2].title}
              </button>
            ) : (
              <>
                <button type="button" disabled={!!busy} className={btnClass(canConfirm ? 'o' : 'p')} onClick={() => submit('save')}>
                  {busy === 'save' && <Loader2 size={16} className="animate-spin" />} Save
                </button>
                {canConfirm && (
                  <button type="button" disabled={!!busy} className={btnClass(canAssign ? 's' : 'p')} onClick={() => submit('confirm')}>
                    {busy === 'confirm' && <Loader2 size={16} className="animate-spin" />} Save & confirm
                  </button>
                )}
                {canConfirm && canAssign && (
                  <button type="button" disabled={!!busy} className={btnClass('p')} onClick={() => submit('assign')}>
                    {busy === 'assign' && <Loader2 size={16} className="animate-spin" />} Save & assign
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function pickPatient(f: F, p: FormPatient): F {
  return {
    ...f,
    mode: 'existing',
    patient: p,
    addr: { area: p.address?.area ?? '', full: p.address?.full ?? '', landmark: p.address?.landmark ?? '' },
    allergies: f.allergies || (p.allergies ?? []).join(', '),
  }
}

// ==================================================================== shared bits
function SectionCard({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">{title}</h2>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({ label, error, children, className, hint }: { label: ReactNode; error?: string; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="hc-label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-slate-400">{hint}</span> : null}
    </label>
  )
}

const errCls = (e?: string) => (e ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20' : '')

type SetF = <K extends keyof F>(k: K, v: F[K]) => void
type SetIn = <K extends 'np' | 'addr' | 'requester'>(k: K, patch: Partial<F[K]>) => void

// ==================================================================== step 1
function StepPatient({ f, set, setIn, zones, errors }: { f: F; set: SetF; setIn: SetIn; zones: string[]; errors: Record<string, string> }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<FormPatient[] | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults(null)
      return
    }
    let live = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: FormPatient[] }>(`/patients?q=${encodeURIComponent(term)}&limit=8`)
        if (live) setResults(r.items)
      } catch {
        if (live) setResults([])
      } finally {
        if (live) setLoading(false)
      }
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const shown = results ?? (f.patient ? [f.patient] : null)
  const openLatest = f.patient?.latest && ACTIVE_STATUSES.includes(f.patient.latest.status as Status) ? f.patient.latest : null

  const choose = (p: FormPatient) => {
    set('mode', 'existing')
    set('patient', p)
    set('addr', { area: p.address?.area ?? '', full: p.address?.full ?? '', landmark: p.address?.landmark ?? '' })
    if (!f.allergies && p.allergies?.length) set('allergies', p.allergies.join(', '))
  }

  return (
    <>
      <SectionCard title="Find existing patient">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className={cx('flex h-11 flex-1 items-center gap-2 rounded-lg border-[1.5px] bg-white px-3 focus-within:border-primary', errors.patient && f.mode === 'existing' ? 'border-[#DC2626]' : 'border-slate-300')}>
            {loading ? <Loader2 size={18} className="animate-spin text-slate-400" /> : <Search size={18} className="text-slate-500" />}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Phone, UHID or name"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              aria-label="Find existing patient"
              autoFocus={!f.patient && f.mode === 'existing'}
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              set('mode', f.mode === 'new' ? 'existing' : 'new')
              if (f.mode !== 'new') {
                set('patient', null)
                // carry a typed phone / name over to the new-patient form
                const digits = q.replace(/\D/g, '')
                if (digits.length >= 6 && !f.np.phone) setIn('np', { phone: q.trim() })
                else if (q.trim() && !digits && !f.np.name) setIn('np', { name: q.trim() })
              }
            }}
            className={cx('inline-flex h-11 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-lg px-[18px] text-sm font-semibold', f.mode === 'new' ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border-[1.5px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
          >
            {f.mode === 'new' ? (
              <>
                <Search size={16} /> Use existing
              </>
            ) : (
              <>
                <Plus size={16} /> New patient
              </>
            )}
          </button>
        </div>

        {f.mode === 'existing' && shown && (
          <div className="mt-2.5 overflow-hidden rounded-[10px] border border-slate-200">
            {shown.length === 0 && (
              <div className="px-3.5 py-4 text-[13px] text-slate-500">
                No patient found for “{q.trim()}”.{' '}
                <button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => set('mode', 'new')}>
                  Add as new patient
                </button>
              </div>
            )}
            {shown.map((p) => {
              const on = f.patient?._id === p._id
              return (
                <div key={p._id} className={cx('flex items-center gap-3 border-b border-slate-100 px-3.5 py-2.5 last:border-b-0', on && 'bg-primary-50')}>
                  <span className="flex size-9 flex-none items-center justify-center rounded-full bg-primary-50 text-[13px] font-bold text-primary-700">{initialsOf(p.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {p.name}{' '}
                      <span className="font-normal text-slate-500">
                        {[ageGender(p.ageYears, p.gender), p.uhid && `UHID ${p.uhid}`, p.address?.area].filter(Boolean).map((x) => ` · ${x}`)}
                      </span>
                    </div>
                    <div className="truncate text-[12px] text-slate-500">
                      {fmtPhone(p.phone)}
                      {p.latest ? ` · ${p.latest.count} visit${p.latest.count === 1 ? '' : 's'}${p.latest.scheduledAt ? ` · last ${dayNum(p.latest.scheduledAt)}` : ''}` : ' · first visit'}
                    </div>
                  </div>
                  {on ? (
                    <span className="inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-primary-50 px-3.5 text-sm font-semibold text-primary-700">
                      <Check size={16} /> Selected
                    </span>
                  ) : (
                    <button type="button" onClick={() => choose(p)} className="inline-flex h-[30px] items-center rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      Select
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {f.mode === 'existing' && !shown && <div className="mt-2.5 text-[13px] text-slate-400">Type at least 2 characters — phone numbers match on the last digits.</div>}
        {errors.patient && f.mode === 'existing' && !f.patient && <div className="mt-2 text-[12px] font-semibold text-[#B91C1C]">{errors.patient}</div>}

        {openLatest && (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#B45309]">
            <AlertTriangle size={16} className="flex-none" />
            <span className="min-w-0 flex-1">
              Open request for this patient: <b>{openLatest.requestNo}</b> <StatusChip status={openLatest.status} sm />
            </span>
            <Link href={`/requests/${openLatest.requestId}`} className="font-bold hover:underline">
              Open
            </Link>
          </div>
        )}

        {f.mode === 'new' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Patient name *" error={errors.name} className="xl:col-span-2">
              <input className={cx('hc-input', errCls(errors.name))} value={f.np.name} onChange={(e) => setIn('np', { name: e.target.value })} autoFocus />
            </Field>
            <Field label="Phone *" error={errors.phone}>
              <input className={cx('hc-input', errCls(errors.phone))} value={f.np.phone} onChange={(e) => setIn('np', { phone: e.target.value })} inputMode="tel" placeholder="01711 234567" />
            </Field>
            <Field label="Alternate phone">
              <input className="hc-input" value={f.np.altPhone} onChange={(e) => setIn('np', { altPhone: e.target.value })} inputMode="tel" />
            </Field>
            <Field label="Age" error={errors.ageYears}>
              <input className={cx('hc-input', errCls(errors.ageYears))} value={f.np.ageYears} onChange={(e) => setIn('np', { ageYears: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="Years" />
            </Field>
            <div>
              <span className="hc-label">Gender</span>
              <Segmented
                h={34}
                value={f.np.gender || ('' as any)}
                onChange={(v) => setIn('np', { gender: v as any })}
                items={[
                  { value: 'M', label: 'Male' },
                  { value: 'F', label: 'Female' },
                  { value: 'O', label: 'Other' },
                ]}
              />
            </div>
            <Field label="UHID / MRN">
              <input className="hc-input" value={f.np.uhid} onChange={(e) => setIn('np', { uhid: e.target.value })} placeholder="If registered" />
            </Field>
            <Field label="Email" error={errors.email}>
              <input className={cx('hc-input', errCls(errors.email))} value={f.np.email} onChange={(e) => setIn('np', { email: e.target.value })} type="email" placeholder="For confirmations" />
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Address for this visit"
        right={f.mode === 'existing' && f.patient ? <span className="text-[12px] text-slate-400">Changes update the patient’s address</span> : undefined}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Area / thana">
            <select className="hc-input" value={f.addr.area} onChange={(e) => setIn('addr', { area: e.target.value })}>
              <option value="">Select area</option>
              {[...new Set([...zones, ...(f.addr.area && !zones.includes(f.addr.area) ? [f.addr.area] : [])])].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </Field>
          <Field label="Full address *" error={errors.full}>
            <input className={cx('hc-input', errCls(errors.full))} value={f.addr.full} onChange={(e) => setIn('addr', { full: e.target.value })} placeholder="House, road, block" />
          </Field>
          <Field label="Landmark">
            <input className="hc-input" value={f.addr.landmark} onChange={(e) => setIn('addr', { landmark: e.target.value })} placeholder="Near…" />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <span className="hc-label">Requester</span>
            <div className="flex flex-wrap gap-2">
              {(['SELF', 'RELATIVE'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setIn('requester', { type: t })}
                  className={cx('h-10 rounded-lg px-4 text-sm font-semibold', f.requester.type === t ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50')}
                >
                  {t === 'SELF' ? 'Self' : 'Relative'}
                </button>
              ))}
              {f.requester.type === 'RELATIVE' && (
                <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                  <input className="hc-input" placeholder="Name" value={f.requester.name} onChange={(e) => setIn('requester', { name: e.target.value })} aria-label="Requester name" />
                  <input className="hc-input" placeholder="Relation" value={f.requester.relation} onChange={(e) => setIn('requester', { relation: e.target.value })} aria-label="Relation" />
                  <input className="hc-input" placeholder="Phone" value={f.requester.phone} onChange={(e) => setIn('requester', { phone: e.target.value })} inputMode="tel" aria-label="Requester phone" />
                </div>
              )}
            </div>
          </div>
          <div>
            <span className="hc-label">Location check (optional)</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([f.addr.full, f.addr.landmark, f.addr.area, 'Dhaka'].filter(Boolean).join(', '))}`}
              target="_blank"
              rel="noreferrer"
              className={cx('relative flex h-10 items-center justify-center gap-1.5 overflow-hidden rounded-card bg-[#E5EEF2] text-[13px] font-semibold text-primary-700', !f.addr.full && 'pointer-events-none opacity-60')}
              style={{ backgroundImage: 'linear-gradient(rgba(15,23,42,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,.06) 1px,transparent 1px)', backgroundSize: '28px 28px' }}
            >
              <MapPin size={15} /> Check address on map
            </a>
          </div>
        </div>
      </SectionCard>
    </>
  )
}

// ==================================================================== step 2
function StepService({ f, set, services, slots, today, errors, autoDuration }: { f: F; set: SetF; services: Service[]; slots: string[]; today: string; errors: Record<string, string>; autoDuration: number }) {
  const [testQ, setTestQ] = useState('')
  const tests = useMemo(() => {
    const t = testQ.trim().toLowerCase()
    const all = [...TESTS_PROCEDURES] as string[]
    return t ? all.filter((x) => x.toLowerCase().includes(t) || f.tests.includes(x)) : all
  }, [testQ, f.tests])
  const toggle = (code: string) => set('serviceCodes', f.serviceCodes.includes(code) ? f.serviceCodes.filter((c) => c !== code) : [...f.serviceCodes, code])
  const tomorrow = useMemo(() => {
    const d = new Date(`${today}T12:00:00+06:00`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [today])
  return (
    <>
      <SectionCard title="Service" right={errors.services ? <span className="text-[12px] font-semibold text-[#B91C1C]">{errors.services}</span> : <span className="text-[12px] text-slate-400">Select one or more</span>}>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {services.map((s) => {
            const on = f.serviceCodes.includes(s.code)
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => toggle(s.code)}
                aria-pressed={on}
                className={cx('flex items-start gap-2.5 rounded-[10px] border-[1.5px] p-3 text-left transition', on ? 'border-primary bg-primary-50' : 'border-slate-200 bg-white hover:border-slate-300')}
              >
                <span className={cx('mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-md border-2', on ? 'border-primary bg-primary text-white' : 'border-slate-300')}>{on && <Check size={12} strokeWidth={3.5} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{s.name}</span>
                  <span className="block text-[12px] text-slate-500">{[s.category, `${s.duration} min`, s.fee ? taka(s.fee) : null].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            )
          })}
        </div>
        <Field label="Other service (not in the list)" className="mt-3 max-w-md">
          <input className="hc-input" value={f.otherService} onChange={(e) => set('otherService', e.target.value)} placeholder="Describe the service" />
        </Field>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-slate-700">
              Tests / procedures {f.tests.length > 0 && <span className="text-primary-700">· {f.tests.length} selected</span>}
            </span>
            <input className="hc-input h-8 max-w-[220px] text-[13px]" placeholder="Filter tests…" value={testQ} onChange={(e) => setTestQ(e.target.value)} aria-label="Filter tests" />
          </div>
          <div className="max-h-[168px] overflow-y-auto rounded-lg border border-slate-100 p-2">
            <ChipPicker options={tests} value={f.tests} onChange={(v) => set('tests', v)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Schedule">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <span className="hc-label">Priority</span>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['ROUTINE', 'Routine', 'border-slate-900 bg-slate-900 text-white'],
                  ['URGENT', 'Urgent', 'border-[#F59E0B] bg-[#F59E0B] text-white'],
                  ['EMERGENCY', 'Emergency', 'border-[#DC2626] bg-[#DC2626] text-white'],
                ] as const
              ).map(([v, label, onCls]) => (
                <button key={v} type="button" onClick={() => set('priority', v)} className={cx('h-10 rounded-lg border text-sm font-semibold', f.priority === v ? onCls : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Preferred date" error={errors.date}>
              <input type="date" className={cx('hc-input', errCls(errors.date))} value={f.date} min={today} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => set('date', today)} className={cx('h-10 rounded-lg px-3 text-[13px] font-semibold', f.date === today ? 'bg-primary-50 text-primary-700' : 'border border-slate-300 text-slate-700')}>
                Today
              </button>
              <button type="button" onClick={() => set('date', tomorrow)} className={cx('h-10 rounded-lg px-3 text-[13px] font-semibold', f.date === tomorrow ? 'bg-primary-50 text-primary-700' : 'border border-slate-300 text-slate-700')}>
                Tomorrow
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-slate-700">Time</span>
            <div className="w-[220px]">
              <Segmented
                h={30}
                value={f.timeMode}
                onChange={(v) => set('timeMode', v)}
                items={[
                  { value: 'slot', label: 'Slot' },
                  { value: 'time', label: 'Exact time' },
                ]}
              />
            </div>
          </div>
          {f.timeMode === 'slot' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('slot', f.slot === s ? '' : s)}
                  className={cx('h-11 rounded-lg border-[1.5px] text-sm font-semibold', f.slot === s ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <Field label="Exact time" error={errors.time} className="max-w-[200px]">
              <input type="time" className={cx('hc-input', errCls(errors.time))} value={f.time} onChange={(e) => set('time', e.target.value)} />
            </Field>
          )}
          <div className="mt-1.5 text-[12px] text-slate-400">{f.priority !== 'ROUTINE' && !f.slot && !f.time ? 'Leave empty for ASAP.' : 'Optional — the coordinator confirms the final time.'}</div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Expected duration (min)" hint={`Auto from services: ${autoDuration} min`}>
            <input className="hc-input" inputMode="numeric" value={f.duration} placeholder={String(autoDuration)} onChange={(e) => set('duration', e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </Field>
          <div>
            <span className="hc-label">Transport</span>
            <div className="flex h-10 items-center gap-3">
              <Toggle on={f.transport} onChange={(v) => set('transport', v)} label="Transport needed" />
              <span className="text-sm text-slate-700">{f.transport ? 'Unico car needed' : 'Staff travel on their own'}</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  )
}

// ==================================================================== step 3
function StepClinical({ f, set, services, autoFee, fee, errors }: { f: F; set: SetF; services: Service[]; autoFee: number; fee: number; errors: Record<string, string> }) {
  const who = f.mode === 'existing' ? f.patient?.name : f.np.name
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Clinical">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Chief complaint" className="md:col-span-2">
              <textarea className="hc-input" rows={2} value={f.complaint} onChange={(e) => set('complaint', e.target.value)} placeholder="Reason for the visit" />
            </Field>
            <Field label="Clinical notes" className="md:col-span-2">
              <textarea className="hc-input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="History, current medication, instructions for the team" />
            </Field>
            <Field label="Referring doctor">
              <input className="hc-input" value={f.refDoctor} onChange={(e) => set('refDoctor', e.target.value)} />
            </Field>
            <Field label="Allergies" hint="Separate with commas">
              <input className="hc-input" value={f.allergies} onChange={(e) => set('allergies', e.target.value)} placeholder="e.g. Penicillin, Latex" />
            </Field>
          </div>
        </SectionCard>
        <SectionCard title="Payment & source">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Estimated fee (৳)" error={errors.fee} hint={f.fee === '' ? `Auto: sum of service fees (${taka(autoFee)})` : <button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => set('fee', '')}>Reset to {taka(autoFee)}</button>}>
              <input className={cx('hc-input', errCls(errors.fee))} inputMode="numeric" value={f.fee === '' ? String(autoFee) : f.fee} onChange={(e) => set('fee', e.target.value.replace(/[^\d.]/g, ''))} />
            </Field>
            <div>
              <span className="hc-label">Payment method</span>
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" onClick={() => set('payment', f.payment === m ? '' : m)} className={cx('h-10 rounded-lg border text-sm font-semibold', f.payment === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Source">
              <select className="hc-input" value={f.source} onChange={(e) => set('source', e.target.value as F['source'])}>
                {REQUEST_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s] ?? s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Remarks">
              <input className="hc-input" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="Anything the coordinator should know" />
            </Field>
          </div>
        </SectionCard>
      </div>

      <aside className="h-fit rounded-card bg-white p-5 shadow-card">
        <div className="text-base font-bold">Summary</div>
        <dl className="mt-3 flex flex-col gap-2.5 text-sm">
          <Row k="Patient" v={who || '—'} sub={f.mode === 'new' ? 'New patient' : f.patient ? fmtPhone(f.patient.phone) : undefined} />
          <Row k="Address" v={[f.addr.full, f.addr.area].filter(Boolean).join(', ') || '—'} />
          <Row k="Services" v={[...services.map((s) => s.name), f.otherService.trim()].filter(Boolean).join(', ') || '—'} sub={f.tests.length ? `${f.tests.length} test${f.tests.length === 1 ? '' : 's'} / procedures` : undefined} />
          <Row k="Priority" v={f.priority[0] + f.priority.slice(1).toLowerCase()} />
          <Row k="When" v={f.date ? `${dayNum(`${f.date}T12:00:00+06:00`)} · ${f.timeMode === 'slot' ? f.slot || 'any slot' : f.time || 'any time'}` : 'ASAP'} />
          <Row k="Transport" v={f.transport ? 'Unico car' : 'Own'} />
          <Row k="Estimated fee" v={taka(fee)} />
        </dl>
      </aside>
    </div>
  )
}

function Row({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0">
      <dt className="flex-none text-slate-500">{k}</dt>
      <dd className="min-w-0 text-right font-semibold">
        {v}
        {sub && <div className="text-[12px] font-normal text-slate-500">{sub}</div>}
      </dd>
    </div>
  )
}
