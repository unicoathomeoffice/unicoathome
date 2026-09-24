'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Minus, Plus, Search, X } from 'lucide-react'
import { api, useAction, Sheet, Toggle } from '@/components/client'
import { SLOTS } from '@/lib/constants'
import { cx, isoDay, day as fmtDay } from '@/lib/format'
import { FLabel, SLabel, FixedBottom, bbtn, abtn, chipClass, ageG } from './ui'

type Svc = { code: string; name: string; defaultDurationMin?: number }
type Pt = { _id: string; name: string; ageYears?: number; gender?: string; phone?: string; uhid?: string; address?: { area?: string } }
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function planDates(start: string, weeks: number, dow: number[]) {
  const out: string[] = []
  if (!start) return out
  const s = new Date(`${start}T00:00:00Z`)
  for (let i = 0; i < weeks * 7 && out.length < 60; i++) {
    const d = new Date(s.getTime() + i * 86400_000)
    if (dow.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** P1 — create a care plan: patient, service, days of week, time, start, weeks, ordered by. */
export function CarePlanForm({ services, initialPatient }: { services: Svc[]; initialPatient?: Pt | null }) {
  const router = useRouter()
  const [patient, setPatient] = useState<Pt | null>(initialPatient ?? null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Pt[]>([])
  const [service, setService] = useState(services.find((s) => s.code === 'NURSING')?.code ?? services[0]?.code ?? '')
  const [title, setTitle] = useState('')
  const [dow, setDow] = useState<number[]>([1, 3, 5])
  const [slot, setSlot] = useState('15–17')
  const [time, setTime] = useState('15:00')
  const [start, setStart] = useState(isoDay(Date.now() + 86400_000))
  const [weeks, setWeeks] = useState(4)
  const [orderedBy, setOrderedBy] = useState('')
  const [transport, setTransport] = useState(false)
  const { run, busy } = useAction()
  useEffect(() => {
    if (patient || q.trim().length < 2) return setResults([])
    const t = setTimeout(async () => {
      try {
        setResults((await api<{ items: Pt[] }>(`/patients?q=${encodeURIComponent(q.trim())}&limit=6`)).items)
      } catch {
        setResults([])
      }
    }, 280)
    return () => clearTimeout(t)
  }, [q, patient])
  const dates = useMemo(() => planDates(start, weeks, dow).filter((d) => d >= isoDay()), [start, weeks, dow])
  const ok = !!patient && !!service && dow.length > 0 && !!time && dates.length > 0
  return (
    <>
      <div>
        <FLabel req>Patient</FLabel>
        {patient ? (
          <div className="flex items-center gap-3 rounded-card bg-primary-50 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold">
                {patient.name} <span className="font-normal text-slate-500">· {ageG(patient.ageYears, patient.gender)}</span>
              </div>
              <div className="truncate text-[12px] text-slate-600">{[patient.uhid && `UHID ${patient.uhid}`, patient.address?.area].filter(Boolean).join(' · ')}</div>
            </div>
            <button type="button" className="text-[14px] font-semibold text-primary-700" onClick={() => setPatient(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <label className="flex h-12 items-center gap-2 rounded-[10px] border-[1.5px] border-slate-300 bg-white px-3 focus-within:border-primary">
              <Search size={20} className="text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone, UHID or name" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
              {q && <X size={16} className="text-slate-400" onClick={() => setQ('')} />}
            </label>
            {results.length > 0 && (
              <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
                {results.map((p) => (
                  <button key={p._id} type="button" onClick={() => setPatient(p)} className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-bold">{p.name}</span>
                      <span className="block truncate text-[12px] text-slate-500">{[ageG(p.ageYears, p.gender), p.uhid && `UHID ${p.uhid}`, p.address?.area].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="h-9 rounded-[10px] bg-primary px-3.5 py-2 text-[14px] font-bold text-white">Select</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div>
        <FLabel req>Service</FLabel>
        <div className="flex flex-wrap gap-2">
          {services.map((s) => (
            <button key={s.code} type="button" onClick={() => setService(s.code)} className={chipClass(service === s.code)}>
              {service === s.code && <Check size={15} strokeWidth={3} />}
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FLabel>Plan name</FLabel>
        <input className="hc-input hc-input-lg" placeholder="e.g. Post-stroke nursing" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <FLabel req>Days of the week</FLabel>
        <div className="grid grid-cols-7 gap-1.5">
          {DAYS.map((d, i) => {
            const on = dow.includes(i)
            return (
              <button key={i} type="button" onClick={() => setDow(on ? dow.filter((x) => x !== i) : [...dow, i].sort())} className={cx('h-11 rounded-[10px] text-[15px] font-bold', on ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-600')} aria-label={DAY_NAMES[i]}>
                {d}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <FLabel req>Slot & time</FLabel>
        <div className="grid grid-cols-4 gap-2">
          {SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSlot(s)
                setTime(`${s.slice(0, 2)}:00`)
              }}
              className={cx('h-10 rounded-[10px] text-[13px] font-bold', slot === s ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-600')}
            >
              {s}
            </button>
          ))}
        </div>
        <input type="time" className="hc-input hc-input-lg mt-2" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <FLabel req>Start date</FLabel>
          <input type="date" className="hc-input hc-input-lg" min={isoDay()} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <FLabel req>Weeks</FLabel>
          <div className="flex h-12 items-center justify-between rounded-lg border-[1.5px] border-slate-300 bg-white px-1.5">
            <button type="button" onClick={() => setWeeks(Math.max(1, weeks - 1))} className="flex size-9 items-center justify-center rounded-md bg-slate-100" aria-label="Fewer weeks">
              <Minus size={16} />
            </button>
            <span className="text-[16px] font-bold">{weeks}</span>
            <button type="button" onClick={() => setWeeks(Math.min(12, weeks + 1))} className="flex size-9 items-center justify-center rounded-md bg-slate-100" aria-label="More weeks">
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>
      <div>
        <FLabel>Ordered by</FLabel>
        <input className="hc-input hc-input-lg" placeholder="Doctor's name" value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} />
      </div>
      <div className="flex items-center gap-3 rounded-card bg-white px-3.5 py-3 shadow-card">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Transport needed</div>
          <div className="text-[12px] text-slate-500">Each visit sends a trip request to the car supervisor</div>
        </div>
        <Toggle on={transport} onChange={setTransport} label="Transport needed" />
      </div>
      <SLabel right={dates.length ? `${dates.length} visits` : undefined}>Preview</SLabel>
      <div className="rounded-card bg-white px-3.5 py-3 text-[13px] shadow-card">
        {dates.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {dates.slice(0, 14).map((d) => (
                <span key={d} className="rounded-full bg-[#E0E7FF] px-2 py-0.5 text-[12px] font-semibold text-[#4338CA]">
                  {fmtDay(`${d}T12:00:00+06:00`)}
                </span>
              ))}
              {dates.length > 14 && <span className="text-[12px] text-slate-500">+{dates.length - 14} more</span>}
            </div>
            <div className="mt-2 text-slate-500">Each visit is created as a NEW request for the coordinator to confirm and assign.</div>
          </>
        ) : (
          <span className="text-slate-500">Pick days and a start date to see the visits.</span>
        )}
      </div>
      <FixedBottom>
        <button
          type="button"
          disabled={busy || !ok}
          className={bbtn('p', 'flex-1')}
          onClick={async () => {
            const r = await run(() => api<{ id: string; count: number }>('/care-plans', { body: { patientId: patient!._id, serviceCode: service, daysOfWeek: dow, time, slot, startDate: start, weeks, orderedBy: orderedBy.trim() || undefined, title: title.trim() || undefined, transportNeeded: transport } }), (x) => `Care plan created · ${x.count} visits`, { refresh: false })
            if (r) router.push(`/m/care-plans/${r.id}`)
          }}
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          Create plan · {dates.length} visit{dates.length === 1 ? '' : 's'}
        </button>
      </FixedBottom>
    </>
  )
}

/** Pause / resume / end / edit a plan (P1). */
export function PlanActions({ id, status, title, orderedBy, future }: { id: string; status: string; title?: string; orderedBy?: string; future: number }) {
  const [edit, setEdit] = useState(false)
  const [t, setT] = useState(title ?? '')
  const [o, setO] = useState(orderedBy ?? '')
  const { run, busy } = useAction()
  const set = (s: string, msg: string, confirm?: string) => async () => {
    if (confirm && !window.confirm(confirm)) return
    await run(() => api<{ cancelled: number; created: number }>(`/care-plans/${id}`, { method: 'PATCH', body: { status: s } }), (r) => `${msg}${r.cancelled ? ` · ${r.cancelled} visits cancelled` : ''}${r.created ? ` · ${r.created} visits re-created` : ''}`)
  }
  if (status === 'ENDED') return <div className="text-center text-[13px] text-slate-500">This plan has ended.</div>
  return (
    <>
      <div className="flex gap-2">
        {status === 'ACTIVE' ? (
          <button type="button" disabled={busy} className={abtn('o', 'flex-1')} onClick={set('PAUSED', 'Plan paused', future ? `Pause the plan? ${future} upcoming visit${future === 1 ? '' : 's'} not yet assigned will be cancelled.` : undefined)}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Pause plan
          </button>
        ) : (
          <button type="button" disabled={busy} className={abtn('p', 'flex-1')} onClick={set('ACTIVE', 'Plan resumed')}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Resume plan
          </button>
        )}
        <button type="button" className={abtn('soft', 'flex-1')} onClick={() => setEdit(true)}>
          Edit
        </button>
        <button type="button" disabled={busy} className={abtn('r', 'flex-1')} onClick={set('ENDED', 'Plan ended', 'End this plan? Upcoming unassigned visits are cancelled.')}>
          End
        </button>
      </div>
      <Sheet
        open={edit}
        onClose={() => setEdit(false)}
        title="Edit plan"
        sub="Change the schedule by pausing and creating a new plan"
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setEdit(false)}>
              Cancel
            </button>
            <button
              className={bbtn('p', 'flex-[1.6]')}
              disabled={busy}
              onClick={async () => {
                const r = await run(() => api(`/care-plans/${id}`, { method: 'PATCH', body: { title: t.trim(), orderedBy: o.trim() } }), 'Plan saved')
                if (r) setEdit(false)
              }}
            >
              Save
            </button>
          </>
        }
      >
        <FLabel>Plan name</FLabel>
        <input className="hc-input hc-input-lg" value={t} onChange={(e) => setT(e.target.value)} />
        <FLabel className="mt-3">Ordered by</FLabel>
        <input className="hc-input hc-input-lg" value={o} onChange={(e) => setO(e.target.value)} />
      </Sheet>
    </>
  )
}

/** "Add a visit to this plan" (P1 bottom action). */
export function AddPlanVisit({ id, time: defTime, disabled }: { id: string; time?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState(isoDay(Date.now() + 86400_000))
  const [t, setT] = useState(defTime ?? '15:00')
  const { run, busy } = useAction()
  return (
    <>
      <button type="button" disabled={disabled} className={bbtn('p', 'flex-1')} onClick={() => setOpen(true)}>
        Add a visit to this plan
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add a visit"
        sub="Created as NEW for the coordinator to confirm"
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className={bbtn('p', 'flex-[1.6]')}
              disabled={busy || !d}
              onClick={async () => {
                const r = await run(() => api<{ requestNo: string }>(`/care-plans/${id}`, { body: { date: d, time: t } }), (x) => `${x.requestNo} added to the plan`)
                if (r) setOpen(false)
              }}
            >
              {busy && <Loader2 size={18} className="animate-spin" />}
              Add visit
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <FLabel req>Date</FLabel>
            <input type="date" className="hc-input hc-input-lg" min={isoDay()} value={d} onChange={(e) => setD(e.target.value)} />
          </div>
          <div>
            <FLabel req>Time</FLabel>
            <input type="time" className="hc-input hc-input-lg" value={t} onChange={(e) => setT(e.target.value)} />
          </div>
        </div>
      </Sheet>
    </>
  )
}
