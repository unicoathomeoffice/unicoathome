'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Calendar, Camera, Check, ChevronLeft, Clock, Loader2, Search, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api, useToast, Segmented, uploadFile } from '@/components/client'
import { ApiClientError } from '@/components/client/api'
import { SLOTS, ZONES, STATUS_COLORS, STATUS_LABEL, type Status } from '@/lib/constants'
import { cx, isoDay, day as fmtDay, taka } from '@/lib/format'
import { FLabel, SLabel, FixedBottom, bbtn, chipClass, ageG } from './ui'

type Svc = { code: string; name: string; fee?: number; defaultDurationMin?: number; category?: string }
type Pt = { _id: string; name: string; ageYears?: number; gender?: string; phone: string; uhid?: string; address?: { area?: string; full?: string }; latest?: { count?: number; status?: string } | null }
type Me = { name: string; initials: string; designation?: string; employeeId: string; roleLabel: string; isDesk: boolean; isField: boolean; canConfirm: boolean }
type From = { id: string; requestNo: string; status: string; time?: string; slot?: string }

const QUICK = ['DOCTOR_VISIT', 'SAMPLE_COLLECTION', 'ECG_HOME', 'INJECTION_IV']
const QUICK_LABEL: Record<string, string> = { DOCTOR_VISIT: 'Doctor’s consultation', SAMPLE_COLLECTION: 'Sample collection', ECG_HOME: 'ECG', INJECTION_IV: 'Injection pushing' }
const FOLLOW = ['NURSING', 'DOCTOR_VISIT', 'WOUND_DRESSING', 'SAMPLE_COLLECTION', 'PHYSIO', 'INJECTION_IV']

const addDays = (n: number) => isoDay(Date.now() + n * 86400_000)
const dayLabel = (ymd: string) => fmtDay(`${ymd}T12:00:00+06:00`)
const guessArea = (addr: string) => ZONES.find((z) => addr.toLowerCase().includes(z.toLowerCase()))

function StatusDot({ status }: { status: string }) {
  const [bg, fg, dot] = STATUS_COLORS[status as Status] ?? STATUS_COLORS.NEW
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[10.5px] font-bold uppercase tracking-[.02em]" style={{ background: bg, color: fg }}>
      <span className="size-1.5 rounded-full" style={{ background: dot }} />
      {STATUS_LABEL[status as Status] ?? status}
    </span>
  )
}

function Header({ title, sub, onBack, backHref, right }: { title: string; sub?: string; onBack?: () => void; backHref: string; right?: React.ReactNode }) {
  const cls = 'flex size-10 items-center justify-center text-slate-700'
  return (
    <header className="sticky top-0 z-20 -mx-5 -mt-4 mb-1 flex items-center gap-2 border-b border-slate-200 bg-white px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
      {onBack ? (
        <button type="button" onClick={onBack} className={cls} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      ) : (
        <Link href={backHref} className={cls} aria-label="Back">
          <ChevronLeft size={22} />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-bold">{title}</div>
        {sub && <div className="truncate text-[13px] text-slate-500">{sub}</div>}
      </div>
      {right}
    </header>
  )
}

function Steps({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className={cx('h-1 rounded-full', i <= n ? 'bg-primary' : 'bg-slate-300')} />
      ))}
    </div>
  )
}

/** S1 quick request (default) · M19 three-step form ("More details") · M24 follow-up from a visit (?from=). */
export function NewRequestForm({ me, services, initialPatient, from, backHref }: { me: Me; services: Svc[]; initialPatient?: Pt | null; from?: From | null; backHref: string }) {
  const router = useRouter()
  const toast = useToast()
  const followUp = !!from
  const [mode, setMode] = useState<'quick' | 1 | 2 | 3>('quick')
  // patient
  const [patient, setPatient] = useState<Pt | null>(initialPatient ?? null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Pt[]>([])
  const [searching, setSearching] = useState(false)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState<'' | 'M' | 'F' | 'O'>('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [area, setArea] = useState('')
  const [landmark, setLandmark] = useState('')
  const [requester, setRequester] = useState<'SELF' | 'RELATIVE' | 'STAFF'>(me.isField ? 'STAFF' : 'SELF')
  const [reqName, setReqName] = useState('')
  const [reqRelation, setReqRelation] = useState('')
  const [reqPhone, setReqPhone] = useState('')
  const [source, setSource] = useState<'PHONE' | 'WALK_IN' | 'WHATSAPP' | 'APP'>(me.isDesk ? 'PHONE' : 'APP')
  // service & schedule
  const [codes, setCodes] = useState<string[]>([])
  const [showOther, setShowOther] = useState(false)
  const [other, setOther] = useState('')
  const [priority, setPriority] = useState<'ROUTINE' | 'URGENT' | 'EMERGENCY'>('ROUTINE')
  const [date, setDate] = useState(followUp ? addDays(2) : '')
  const [when, setWhen] = useState<'1' | '2' | '7' | 'pick'>('2')
  const [time, setTime] = useState(from?.time ?? '')
  const [slot, setSlot] = useState(from?.slot ?? '')
  const [duration, setDuration] = useState('')
  // clinical & payment
  const [notes, setNotes] = useState('')
  const [refDoc, setRefDoc] = useState('')
  const [allergies, setAllergies] = useState('')
  const [fee, setFee] = useState('')
  const [pay, setPay] = useState<'CASH' | 'BKASH' | 'NAGAD' | 'CARD'>('CASH')
  const [remarks, setRemarks] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  // submit
  const [busy, setBusy] = useState(false)
  const [dup, setDup] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; requestNo: string } | null>(null)
  const [nowLabel] = useState(() => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' }))

  // patient search (phone / UHID / name)
  useEffect(() => {
    if (patient || q.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api<{ items: Pt[] }>(`/patients?q=${encodeURIComponent(q.trim())}&limit=6`)
        setResults(r.items)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [q, patient])

  const svcByCode = useMemo(() => Object.fromEntries(services.map((s) => [s.code, s])), [services])
  const estimate = codes.reduce((a, c) => a + (svcByCode[c]?.fee ?? 0), 0)
  const toggle = (c: string) => setCodes(codes.includes(c) ? codes.filter((x) => x !== c) : [...codes, c])
  const patientOk = !!patient || (name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 6 && address.trim().length >= 3 && (mode === 'quick' ? !!age && !!gender : true))
  const serviceOk = codes.length > 0 || (showOther && other.trim().length > 1)
  const scheduleOk = followUp ? !!date : mode === 'quick' ? !!date && !!time : !!date

  function reset() {
    setDone(null)
    setDup(null)
    setMode('quick')
    setPatient(initialPatient ?? null)
    setName('')
    setAge('')
    setGender('')
    setPhone('')
    setAddress('')
    setArea('')
    setLandmark('')
    setCodes([])
    setOther('')
    setShowOther(false)
    setNotes('')
    setRefDoc('')
    setAllergies('')
    setFee('')
    setRemarks('')
    setFiles([])
    setQ('')
  }

  async function submit(ignoreDuplicate = false) {
    if (!patientOk) return toast('Choose the patient or fill in name, contact and address', 'err')
    if (!serviceOk) return toast('Pick at least one service', 'err')
    if (!scheduleOk) return toast('Set the preferred date' + (mode === 'quick' && !followUp ? ' and time' : ''), 'err')
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        patientId: patient?._id,
        patient: patient
          ? undefined
          : {
              name: name.trim(),
              phone: phone.trim(),
              ageYears: age ? Number(age) : undefined,
              gender: gender || undefined,
              address: { full: address.trim(), area: area || guessArea(address) || undefined, landmark: landmark.trim() || undefined },
            },
        requester: requester === 'RELATIVE' ? { type: 'RELATIVE', name: reqName || undefined, relation: reqRelation || undefined, phone: reqPhone || undefined } : requester === 'STAFF' ? { type: 'STAFF', name: me.name } : { type: 'SELF' },
        serviceCodes: codes,
        otherService: showOther && other.trim() ? other.trim() : undefined,
        tests: [],
        priority,
        preferredDate: date || undefined,
        preferredTime: time || undefined,
        preferredSlot: slot || undefined,
        expectedDurationMin: duration ? Number(duration) : undefined,
        complaint: notes.trim() || undefined,
        referringDoctor: refDoc.trim() || undefined,
        allergies: allergies.trim() ? allergies.split(',').map((a) => a.trim()).filter(Boolean) : undefined,
        estimatedFee: fee ? Number(fee) : undefined,
        paymentMethod: mode === 3 ? pay : undefined,
        source,
        remarks: [followUp ? `Follow-up of ${from!.requestNo}` : '', remarks.trim()].filter(Boolean).join(' · ') || undefined,
        ignoreDuplicate: ignoreDuplicate || undefined,
      }
      const r = await api<{ id: string; requestNo: string }>('/requests', { body })
      for (const f of files) {
        try {
          await uploadFile(f, { kind: 'PRESCRIPTION', requestId: r.id })
        } catch {
          toast(`Could not upload ${f.name}`, 'err')
        }
      }
      setDup(null)
      setDone(r)
      window.scrollTo({ top: 0 })
      router.refresh()
    } catch (e) {
      const err = e as ApiClientError
      if (err?.code === 'DUPLICATE') setDup(err.message)
      else toast(err?.message ?? 'Could not send the request', 'err')
    } finally {
      setBusy(false)
    }
  }

  const requestedBy = (
    <div className="flex items-center gap-2.5 text-[12px] text-slate-500">
      <div className="flex size-6 flex-none items-center justify-center rounded-full bg-primary-50 text-[9px] font-bold text-primary-700">{me.initials}</div>
      <span>
        Requested by <b className="text-slate-900">{me.name}</b> · {me.designation ?? me.roleLabel} · {me.employeeId}
        {mode === 1 && <> · source: {source === 'APP' ? 'App' : source === 'WALK_IN' ? 'Walk-in' : source === 'WHATSAPP' ? 'WhatsApp' : 'Phone'}</>}
      </span>
    </div>
  )

  // ---------------------------------------------------------------- success
  if (done)
    return (
      <>
        <Header title="Request sent" backHref={backHref} />
        <div className="mt-6 flex flex-col items-center text-center">
          <div className="flex size-20 items-center justify-center rounded-full bg-[#DCFCE7] text-[#16A34A]">
            <CheckCircle2 size={44} />
          </div>
          <div className="mt-4 text-[22px] font-bold">{done.requestNo}</div>
          <div className="mt-1 max-w-[300px] text-[14px] text-slate-500">
            {me.canConfirm ? 'Created as NEW. Confirm it now, or leave it in the inbox.' : me.isDesk ? 'Created as NEW — it is in the coordinator’s inbox.' : 'It is in the coordinator’s inbox as NEW. You will get a notification when it is confirmed.'}
          </div>
        </div>
        <FixedBottom>
          <button type="button" className={bbtn('o', 'flex-1')} onClick={reset}>
            New request
          </button>
          <Link href={me.canConfirm ? `/m/admin/requests/${done.id}/confirm` : me.isDesk ? `/m/admin/requests/${done.id}` : backHref} className={bbtn('p', 'flex-[1.4]')}>
            {me.canConfirm ? 'Confirm now' : me.isDesk ? 'Open request' : 'Done'}
          </Link>
        </FixedBottom>
      </>
    )

  const dupCard = dup && (
    <div className="rounded-card border-[1.5px] border-[#FCD34D] bg-[#FFFBEB] px-3.5 py-3">
      <div className="flex items-start gap-2 text-[14px] font-semibold text-[#B45309]">
        <AlertTriangle size={18} className="mt-px flex-none" />
        {dup}
      </div>
      <div className="mt-1 text-[12px] text-[#92400E]">Check with the patient before sending a second request.</div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" className={cx('h-10 flex-1 rounded-xl border-[1.5px] border-slate-300 bg-white text-sm font-bold text-slate-700')} onClick={() => setDup(null)}>
          Go back
        </button>
        <button type="button" disabled={busy} className="h-10 flex-1 rounded-xl bg-[#F59E0B] text-sm font-bold text-white" onClick={() => submit(true)}>
          Create anyway
        </button>
      </div>
    </div>
  )

  const patientPicker = (
    <>
      {patient ? (
        <div className="flex items-center gap-3 rounded-card bg-primary-50 px-3.5 py-3">
          <div className="flex size-10 flex-none items-center justify-center rounded-full bg-white text-[14px] font-bold text-primary-700">{initials(patient.name)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">
              {patient.name} <span className="font-normal text-slate-500">· {ageG(patient.ageYears, patient.gender)}</span>
            </div>
            <div className="truncate text-[12px] text-slate-600">
              {[patient.uhid && `UHID ${patient.uhid}`, patient.address?.area, patient.phone].filter(Boolean).join(' · ')}
            </div>
          </div>
          {!initialPatient || !followUp ? (
            <button type="button" className="text-[14px] font-semibold text-primary-700" onClick={() => setPatient(null)}>
              Change
            </button>
          ) : null}
        </div>
      ) : (
        <div>
          <label className="flex h-12 items-center gap-2 rounded-[10px] border-[1.5px] border-slate-300 bg-white px-3 focus-within:border-primary">
            <Search size={20} className="flex-none text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Existing patient? Search phone or UHID" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400" inputMode="search" />
            {searching ? <Loader2 size={16} className="animate-spin text-slate-400" /> : q && <X size={16} className="text-slate-400" onClick={() => setQ('')} />}
          </label>
          {results.length > 0 && (
            <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
              {results.map((p) => (
                <div key={p._id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="flex size-9 flex-none items-center justify-center rounded-full bg-primary-50 text-[13px] font-bold text-primary-700">{initials(p.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">
                      {p.name} <span className="font-normal text-slate-500">· {ageG(p.ageYears, p.gender)}</span>
                    </div>
                    <div className="truncate text-[12px] text-slate-500">
                      {[p.uhid ? `UHID ${p.uhid}` : p.phone, p.address?.area, p.latest?.count ? `${p.latest.count} visit${p.latest.count === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="h-9 rounded-[10px] bg-primary px-3.5 text-[14px] font-bold text-white"
                    onClick={() => {
                      setPatient(p)
                      setQ('')
                    }}
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !searching && !results.length && <div className="mt-1.5 text-[12px] text-slate-500">No match — fill in the new patient below.</div>}
        </div>
      )}
    </>
  )

  // ---------------------------------------------------------------- M24 follow-up
  if (followUp)
    return (
      <>
        <Header title="Request follow-up" sub={`From visit ${from!.requestNo}`} backHref={backHref} />
        {patient && (
          <div className="flex items-center gap-3 rounded-card bg-white px-4 py-3.5 shadow-card">
            <div className="flex size-11 flex-none items-center justify-center rounded-full bg-primary-50 text-[15px] font-bold text-primary-700">{initials(patient.name)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-bold">{patient.name}</div>
              <div className="text-[13px] leading-[18px] text-slate-500">
                {ageG(patient.ageYears, patient.gender)} · {patient.address?.full ?? patient.address?.area}
              </div>
            </div>
            <StatusDot status={from!.status} />
          </div>
        )}
        <SLabel>What is needed</SLabel>
        <div className="flex flex-wrap gap-2">
          {(showOther ? services.map((s) => s.code) : FOLLOW.filter((c) => svcByCode[c])).map((c) => (
            <button key={c} type="button" className={chipClass(codes.includes(c))} onClick={() => toggle(c)}>
              {codes.includes(c) && <Check size={15} strokeWidth={3} />}
              {svcByCode[c]?.name}
            </button>
          ))}
          {!showOther && (
            <button type="button" className={chipClass(false, 'border-dashed')} onClick={() => setShowOther(true)}>
              More…
            </button>
          )}
        </div>
        <SLabel>When</SLabel>
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ['1', 'Tomorrow'],
              ['2', 'In 2 days'],
              ['7', 'Next week'],
              ['pick', 'Pick date'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setWhen(k)
                if (k !== 'pick') setDate(addDays(Number(k)))
              }}
              className={cx('h-11 rounded-[10px] text-[13px] font-bold', when === k ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}
            >
              {l}
            </button>
          ))}
        </div>
        {when === 'pick' && <input type="date" className="hc-input hc-input-lg" min={addDays(0)} value={date} onChange={(e) => setDate(e.target.value)} />}
        <div className="-mt-1 text-[12px] text-slate-500">
          {date ? dayLabel(date) : ''}
          {time ? ` · around ${time} like this visit` : ''} — the coordinator confirms the exact time.
        </div>
        <Segmented
          h={40}
          value={priority === 'EMERGENCY' ? 'URGENT' : priority}
          onChange={(v) => setPriority(v as any)}
          items={[
            { value: 'ROUTINE', label: 'Routine' },
            { value: 'URGENT', label: <span className={priority === 'URGENT' ? 'text-[#B45309]' : ''}>Urgent</span> },
          ]}
        />
        <div>
          <FLabel>Reason for the coordinator</FLabel>
          <textarea className="hc-input hc-input-lg h-[104px] py-2.5 leading-6" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What should happen at the next visit, and why?" />
        </div>
        <div className="flex items-center gap-3 rounded-card bg-white px-4 py-3 shadow-card">
          <div className="flex size-9 flex-none items-center justify-center rounded-full bg-primary-50 text-[12px] font-bold text-primary-700">{me.initials}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold">Created by {me.name}</div>
            <div className="text-[12px] text-slate-500">
              {me.designation ?? me.roleLabel} · today {nowLabel} · from app
            </div>
          </div>
          <StatusDot status="NEW" />
        </div>
        {dupCard}
        <FixedBottom>
          <button type="button" disabled={busy} className={bbtn('p', 'flex-1')} onClick={() => submit()}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            Send to coordinator
          </button>
        </FixedBottom>
      </>
    )

  const quickServices = QUICK.filter((c) => svcByCode[c])
  const serviceChips = (all: boolean) => (
    <div className="flex flex-wrap gap-2">
      {(all ? services.map((s) => s.code) : quickServices).map((c) => (
        <button key={c} type="button" className={chipClass(codes.includes(c))} onClick={() => toggle(c)}>
          {codes.includes(c) && <Check size={15} strokeWidth={3} />}
          {all ? svcByCode[c]?.name : QUICK_LABEL[c] ?? svcByCode[c]?.name}
        </button>
      ))}
      {!all && (
        <button type="button" className={chipClass(showOther)} onClick={() => setShowOther(!showOther)}>
          {showOther && <Check size={15} strokeWidth={3} />}
          Other
        </button>
      )}
    </div>
  )

  // ---------------------------------------------------------------- S1 quick form
  if (mode === 'quick')
    return (
      <>
        <Header title="New home care request" sub="Takes about 2 minutes" backHref={backHref} />
        {requestedBy}
        {patientPicker}
        {!patient && (
          <>
            <div>
              <FLabel req>Patient name</FLabel>
              <input className="hc-input hc-input-lg" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2.5">
              <div>
                <FLabel req>Age</FLabel>
                <input className="hc-input hc-input-lg" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} />
              </div>
              <div>
                <FLabel req>Gender</FLabel>
                <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
                  {(['M', 'F'] as const).map((g) => (
                    <button key={g} type="button" onClick={() => setGender(g)} className={cx('flex h-[42px] flex-1 items-center justify-center rounded-lg text-sm font-semibold', gender === g ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <FLabel req>Contact</FLabel>
                <input className="hc-input hc-input-lg" type="tel" inputMode="tel" placeholder="+880" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <FLabel req>Address</FLabel>
              <input className="hc-input hc-input-lg" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, road, area" />
              {guessArea(address) && <div className="mt-1 text-[12px] text-slate-500">Zone: {guessArea(address)}</div>}
            </div>
          </>
        )}
        <div>
          <FLabel req>Service needed</FLabel>
          {serviceChips(false)}
          {showOther && (
            <div className="mt-2 grid gap-2">
              <div className="flex flex-wrap gap-2">
                {services
                  .filter((s) => !QUICK.includes(s.code))
                  .map((s) => (
                    <button key={s.code} type="button" className={chipClass(codes.includes(s.code))} onClick={() => toggle(s.code)}>
                      {codes.includes(s.code) && <Check size={15} strokeWidth={3} />}
                      {s.name}
                    </button>
                  ))}
              </div>
              <input className="hc-input hc-input-lg" placeholder="Something else? Describe it" value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <FLabel req>Preferred date</FLabel>
            <input type="date" className="hc-input hc-input-lg" min={addDays(0)} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <FLabel req>Preferred time</FLabel>
            <input type="time" className="hc-input hc-input-lg" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div>
          <FLabel>Notes for the coordinator</FLabel>
          <textarea className="hc-input hc-input-lg h-[76px] py-2.5" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="button" onClick={() => setMode(1)} className="flex h-11 items-center justify-center rounded-xl border-[1.5px] border-dashed border-slate-300 text-[14px] font-semibold text-primary-700">
          More details · priority, slot, clinical & payment
        </button>
        <div className="text-center text-[12px] leading-[18px] text-slate-400">UHID, tests, team, transport and billing are added later by the coordinator, car supervisor and visiting staff.</div>
        {dupCard}
        <FixedBottom>
          <button type="button" disabled={busy} className={bbtn('p', 'flex-1')} onClick={() => submit()}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            Send request
          </button>
        </FixedBottom>
      </>
    )

  // ---------------------------------------------------------------- M19 three steps
  const stepSub = mode === 1 ? 'Step 1 of 3 · Patient & address' : mode === 2 ? 'Step 2 of 3 · Service & schedule' : 'Step 3 of 3 · Clinical & payment'
  const back = () => setMode(mode === 1 ? 'quick' : ((Number(mode) - 1) as 1 | 2))
  const pName = patient?.name ?? name
  const pLine = patient ? [ageG(patient.ageYears, patient.gender), patient.address?.area].filter(Boolean).join(' · ') : [ageG(age ? Number(age) : null, gender), area || guessArea(address)].filter(Boolean).join(' · ')
  const miniCard = (sub?: string) => (
    <div className="flex items-center gap-3 rounded-card bg-primary-50 px-3.5 py-2.5">
      <div className="flex size-9 flex-none items-center justify-center text-[13px] font-bold text-primary-700">{initials(pName)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">
          <b>{pName || 'New patient'}</b> {pLine && <span className="text-slate-600">· {pLine}</span>}
        </div>
        {sub && <div className="truncate text-[12px] text-slate-600">{sub}</div>}
      </div>
      <button type="button" className="text-[14px] font-semibold text-primary-700" onClick={() => setMode(1)}>
        Edit
      </button>
    </div>
  )
  const days = Array.from({ length: 7 }, (_, i) => addDays(i))

  return (
    <>
      <Header title="New request" sub={stepSub} onBack={back} backHref={backHref} />
      <Steps n={Number(mode)} />
      {mode === 1 && (
        <>
          {requestedBy}
          {me.isDesk && (
            <Segmented
              h={36}
              value={source}
              onChange={setSource}
              items={[
                { value: 'PHONE', label: 'Phone' },
                { value: 'WALK_IN', label: 'Walk-in' },
                { value: 'WHATSAPP', label: 'WhatsApp' },
                { value: 'APP', label: 'App' },
              ]}
            />
          )}
          <SLabel>Find patient</SLabel>
          {patientPicker}
          {!patient && (
            <>
              <div className="flex items-center gap-3 text-[12px] text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                or create new
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <FLabel req>Full name</FLabel>
                  <input className="hc-input hc-input-lg" placeholder="Patient name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <FLabel>Age</FLabel>
                  <input className="hc-input hc-input-lg" inputMode="numeric" placeholder="e.g. 68" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                </div>
                <div>
                  <FLabel>Gender</FLabel>
                  <select className="hc-input hc-input-lg" value={gender} onChange={(e) => setGender(e.target.value as any)}>
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </div>
                <div>
                  <FLabel req>Phone</FLabel>
                  <input className="hc-input hc-input-lg" type="tel" placeholder="+880" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <SLabel>Address</SLabel>
              <div>
                <FLabel>Area / thana</FLabel>
                <select className="hc-input hc-input-lg" value={area || guessArea(address) || ''} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Select area</option>
                  {ZONES.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div>
                <FLabel req>Full address</FLabel>
                <input className="hc-input hc-input-lg" placeholder="House, road, block" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <FLabel>Landmark</FLabel>
                <input className="hc-input hc-input-lg" placeholder="Optional" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
              </div>
            </>
          )}
          <SLabel>Requester</SLabel>
          <Segmented
            h={36}
            value={requester}
            onChange={setRequester}
            items={[
              { value: 'SELF', label: 'Patient' },
              { value: 'RELATIVE', label: 'Relative' },
              { value: 'STAFF', label: 'Staff' },
            ]}
          />
          {requester === 'RELATIVE' && (
            <div className="grid grid-cols-2 gap-2.5">
              <input className="hc-input hc-input-lg" placeholder="Name" value={reqName} onChange={(e) => setReqName(e.target.value)} />
              <input className="hc-input hc-input-lg" placeholder="Relation (son…)" value={reqRelation} onChange={(e) => setReqRelation(e.target.value)} />
              <input className="hc-input hc-input-lg col-span-2" type="tel" placeholder="Relative’s phone" value={reqPhone} onChange={(e) => setReqPhone(e.target.value)} />
            </div>
          )}
          <FixedBottom>
            <button type="button" className={bbtn('p', 'flex-1')} onClick={() => (patientOk ? setMode(2) : toast('Choose the patient or fill in name, phone and address', 'err'))}>
              Next · Service & schedule
            </button>
          </FixedBottom>
        </>
      )}

      {mode === 2 && (
        <>
          {miniCard()}
          <SLabel>Service types</SLabel>
          {serviceChips(true)}
          <SLabel>Priority</SLabel>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['ROUTINE', 'Routine', 'text-slate-700'],
                ['URGENT', 'Urgent', 'text-[#B45309]'],
                ['EMERGENCY', 'Emergency', 'text-[#B91C1C]'],
              ] as const
            ).map(([v, l, c]) => (
              <button key={v} type="button" onClick={() => setPriority(v)} className={cx('h-12 rounded-[10px] text-[15px] font-semibold', priority === v ? (v === 'ROUTINE' ? 'bg-slate-900 text-white' : v === 'URGENT' ? 'bg-[#F59E0B] text-white' : 'bg-[#DC2626] text-white') : cx('border-[1.5px] border-slate-300 bg-white', c))}>
                {l}
              </button>
            ))}
          </div>
          <SLabel>Preferred date & slot</SLabel>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {days.map((d) => {
              const on = d === date
              const x = new Date(`${d}T12:00:00+06:00`)
              return (
                <button key={d} type="button" onClick={() => setDate(d)} className={cx('flex h-[62px] w-[58px] flex-none flex-col items-center justify-center rounded-[10px]', on ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white')}>
                  <span className={cx('text-[12px]', on ? 'text-white/85' : 'text-slate-500')}>{x.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Dhaka' })}</span>
                  <span className="text-[19px] font-bold">{x.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Asia/Dhaka' })}</span>
                </button>
              )
            })}
            <label className={cx('relative flex h-[62px] w-[58px] flex-none flex-col items-center justify-center rounded-[10px] text-[12px] font-semibold', date && !days.includes(date) ? 'bg-primary text-white' : 'border-[1.5px] border-dashed border-slate-300 bg-white text-slate-500')}>
              <Calendar size={18} />
              {date && !days.includes(date) ? dayLabel(date).split(' ').slice(1).join(' ') : 'Other'}
              <input type="date" className="absolute inset-0 opacity-0" min={addDays(0)} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSlot(slot === s ? '' : s)
                  setTime('')
                }}
                className={cx('flex h-12 items-center rounded-[10px] px-4 text-[15px] font-bold', slot === s ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <FLabel>Exact time</FLabel>
              <label className="relative block">
                <input type="time" className="hc-input hc-input-lg" value={time} onChange={(e) => setTime(e.target.value)} />
                <Clock size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </label>
            </div>
            <div>
              <FLabel>Expected duration</FLabel>
              <select className="hc-input hc-input-lg" value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option value="">Default{codes[0] && svcByCode[codes[0]]?.defaultDurationMin ? ` · ${Math.max(...codes.map((c) => svcByCode[c]?.defaultDurationMin ?? 30))} min` : ''}</option>
                {[20, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
          </div>
          <FixedBottom>
            <button type="button" className={bbtn('o', 'flex-1')} onClick={back}>
              Back
            </button>
            <button type="button" className={bbtn('p', 'flex-[1.8]')} onClick={() => (!serviceOk ? toast('Pick at least one service', 'err') : !date ? toast('Pick the preferred date', 'err') : setMode(3))}>
              Next · Clinical & payment
            </button>
          </FixedBottom>
        </>
      )}

      {mode === 3 && (
        <>
          {miniCard([codes.map((c) => svcByCode[c]?.name).join(', ') || other, date && dayLabel(date), slot || time].filter(Boolean).join(' · '))}
          <div>
            <FLabel>Chief complaint</FLabel>
            <textarea className="hc-input hc-input-lg h-[104px] py-2.5 leading-6" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why is the visit needed?" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <FLabel>Referring doctor</FLabel>
              <input className="hc-input hc-input-lg" value={refDoc} onChange={(e) => setRefDoc(e.target.value)} />
            </div>
            <div>
              <FLabel>Allergies</FLabel>
              <input className="hc-input hc-input-lg" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Comma separated" />
            </div>
          </div>
          <SLabel>Attachments</SLabel>
          <div className="flex flex-wrap gap-2.5">
            {files.map((f, i) => (
              <div key={i} className="relative flex size-[88px] items-end overflow-hidden rounded-[10px] bg-gradient-to-b from-slate-300 to-slate-500">
                {f.type.startsWith('image/') && <img src={URL.createObjectURL(f)} alt="" className="absolute inset-0 size-full object-cover" />}
                <span className="relative w-full truncate bg-slate-900/60 px-1.5 py-1 text-[11px] font-semibold text-white">{f.name}</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/90 text-slate-700" aria-label="Remove">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => fileRef.current?.click()} className="flex size-[88px] flex-col items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-primary text-[12px] font-semibold text-primary-700">
              <Camera size={20} /> Add
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 6))
                e.target.value = ''
              }}
            />
          </div>
          <SLabel>Commercial</SLabel>
          <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
            <div>
              <FLabel>Estimated fee</FLabel>
              <label className="flex h-12 items-center gap-2 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 focus-within:border-primary">
                <span className="text-slate-400">৳</span>
                <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" inputMode="numeric" placeholder={estimate ? taka(estimate).replace('৳ ', '') : '0'} value={fee} onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <div>
              <FLabel>Payment</FLabel>
              <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
                {(
                  [
                    ['CASH', 'Cash'],
                    ['BKASH', 'bKash'],
                    ['NAGAD', 'Nagad'],
                    ['CARD', 'Card'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setPay(v)} className={cx('flex h-[42px] min-w-0 flex-1 items-center justify-center rounded-lg text-[13px] font-semibold', pay === v ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <FLabel>Internal remarks</FLabel>
            <textarea className="hc-input hc-input-lg h-[76px] py-2.5" placeholder="Visible to coordinator only" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          {dupCard}
          <FixedBottom>
            <button type="button" className={bbtn('o', 'flex-1')} onClick={back}>
              Back
            </button>
            <button type="button" disabled={busy} className={bbtn('p', 'flex-[1.8]')} onClick={() => submit()}>
              {busy && <Loader2 size={18} className="animate-spin" />}
              {me.isDesk ? 'Create request' : 'Submit to coordinator'}
            </button>
          </FixedBottom>
        </>
      )}
    </>
  )
}

function initials(n?: string) {
  if (!n) return '?'
  const p = n.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}
