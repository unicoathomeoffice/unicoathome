'use client'
import { useMemo, useState } from 'react'
import { Check, ChevronRight, Loader2, Search, X } from 'lucide-react'
import { api, useAction, Sheet, Toggle, Segmented } from '@/components/client'
import { SLOTS, TESTS_PROCEDURES } from '@/lib/constants'
import { cx } from '@/lib/format'
import { FLabel, FixedBottom, bbtn } from './ui'
import { CancelRequestButton } from './actions'

/** Tests & procedures chips with an "Add from 27 …" picker sheet (S2). */
export function TestsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = useMemo(() => TESTS_PROCEDURES.filter((t) => t.toLowerCase().includes(q.toLowerCase())), [q])
  return (
    <div className="rounded-card bg-white px-3.5 py-3 shadow-card">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t} className="inline-flex h-[30px] items-center gap-1 rounded-full bg-primary-50 pl-2.5 pr-1.5 text-[12.5px] font-semibold text-primary-700">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="flex size-5 items-center justify-center" aria-label={`Remove ${t}`}>
                <X size={13} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-slate-400">No tests or procedures yet</div>
      )}
      <button type="button" onClick={() => setOpen(true)} className="mt-2.5 flex w-full items-center justify-between border-t border-slate-100 pt-2.5 text-[14px] font-semibold text-primary-700">
        Add from {TESTS_PROCEDURES.length} tests & procedures
        <ChevronRight size={18} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Tests & procedures"
        sub={`${value.length} selected`}
        footer={
          <button className={bbtn('p', 'flex-1')} onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <label className="mb-2 flex h-11 items-center gap-2 rounded-[10px] border-[1.5px] border-slate-300 px-3">
          <Search size={18} className="text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </label>
        <div className="divide-y divide-slate-100">
          {list.map((t) => {
            const on = value.includes(t)
            return (
              <button key={t} type="button" onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])} className="flex min-h-12 w-full items-center gap-3 py-2 text-left text-[15px]">
                <span className={cx('flex size-[22px] flex-none items-center justify-center rounded-md border-2', on ? 'border-primary bg-primary text-white' : 'border-slate-300')}>{on && <Check size={14} strokeWidth={3} />}</span>
                <span className={on ? 'font-semibold' : ''}>{t}</span>
              </button>
            )
          })}
        </div>
      </Sheet>
    </div>
  )
}

type Props = {
  id: string
  requestNo: string
  date: string
  time: string
  slot?: string
  uhid?: string
  patientUhid?: string
  tests: string[]
  fee?: number
  transport: boolean
  priority: 'ROUTINE' | 'URGENT' | 'EMERGENCY'
  canAssign: boolean
}

const slotStart = (s: string) => `${s.slice(0, 2)}:00`

/** S2 — Stage 2: the coordinator confirms date/time, UHID, tests, fee and transport. */
export function ConfirmForm(p: Props) {
  const [date, setDate] = useState(p.date)
  const [time, setTime] = useState(p.time)
  const [slot, setSlot] = useState(p.slot ?? '')
  const [uhid, setUhid] = useState(p.uhid ?? '')
  const [tests, setTests] = useState<string[]>(p.tests)
  const [fee, setFee] = useState(p.fee != null ? String(p.fee) : '')
  const [transport, setTransport] = useState(p.transport)
  const [priority, setPriority] = useState(p.priority)
  const { run, busy } = useAction()
  const known = !!p.patientUhid && uhid.trim() === p.patientUhid
  const missing = !date || !time
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <FLabel req>Date of service</FLabel>
          <input type="date" className="hc-input hc-input-lg" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <FLabel req>Time</FLabel>
          <input
            type="time"
            className="hc-input hc-input-lg"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              const s = SLOTS.find((x) => e.target.value >= slotStart(x) && e.target.value < `${x.slice(3, 5)}:00`)
              setSlot(s ?? '')
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSlot(s)
              if (!time || time < slotStart(s) || time >= `${s.slice(3, 5)}:00`) setTime(slotStart(s))
            }}
            className={cx('h-10 rounded-[10px] text-[13px] font-bold', slot === s ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-600')}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <FLabel req>Patient UHID</FLabel>
        <div className="relative">
          <input className="hc-input hc-input-lg pr-32" value={uhid} onChange={(e) => setUhid(e.target.value.trim())} placeholder="Look up in HIS" inputMode="numeric" />
          {known ? (
            <span className="absolute right-3.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[12px] font-semibold text-[#15803D]">
              <Check size={14} strokeWidth={3} /> found in HIS
            </span>
          ) : uhid ? (
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-primary-700">saved to patient</span>
          ) : null}
        </div>
      </div>

      <div>
        <FLabel req hint="Confirm with patient">
          Test / procedure details
        </FLabel>
        <TestsPicker value={tests} onChange={setTests} />
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-2.5">
        <div>
          <FLabel>Estimated fee</FLabel>
          <label className="flex h-12 items-center gap-2 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 focus-within:border-primary">
            <span className="text-slate-400">৳</span>
            <input className="min-w-0 flex-1 bg-transparent text-[17px] font-bold outline-none" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
          </label>
        </div>
      </div>

      <div>
        <FLabel>Priority</FLabel>
        <Segmented
          h={40}
          value={priority}
          onChange={setPriority}
          items={[
            { value: 'ROUTINE', label: 'Routine' },
            { value: 'URGENT', label: <span className={priority === 'URGENT' ? 'text-[#B45309]' : ''}>Urgent</span> },
            { value: 'EMERGENCY', label: <span className={priority === 'EMERGENCY' ? 'text-[#B91C1C]' : ''}>Emergency</span> },
          ]}
        />
      </div>

      <div className="flex items-center gap-3 rounded-card bg-white px-3.5 py-3 shadow-card">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Transport needed</div>
          <div className="text-[12px] text-slate-500">Sends a trip request to the car supervisor</div>
        </div>
        <Toggle on={transport} onChange={setTransport} label="Transport needed" />
      </div>

      <FixedBottom note={missing ? 'Set the date and time of service' : !tests.length ? 'No tests yet — fine for a consultation' : undefined}>
        <CancelRequestButton id={p.id} requestNo={p.requestNo} kind="r" big className="flex-1" redirect="/m/admin/inbox" />
        <button
          type="button"
          disabled={busy || missing}
          className={bbtn('p', 'flex-[2]')}
          onClick={() =>
            run(
              () =>
                api(`/requests/${p.id}/confirm`, {
                  body: { date, time, slot: slot || undefined, uhid: uhid || undefined, tests, estimatedFee: fee === '' ? undefined : Number(fee), transportNeeded: transport, priority },
                }),
              `${p.requestNo} confirmed · patient notified`,
              { redirect: p.canAssign ? `/m/admin/requests/${p.id}/assign` : `/m/admin/requests/${p.id}` },
            )
          }
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          Confirm · notify patient
        </button>
      </FixedBottom>
    </>
  )
}
