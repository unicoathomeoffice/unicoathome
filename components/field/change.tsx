'use client'
// R1 (6c) Staff asks to reschedule / cancel / hand over a visit → coordinator approval.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { api, useToast, Segmented, Toggle } from '@/components/client'
import { cx, isoDay } from '@/lib/format'
import { BottomBar, CHeader, Body, bigBtn } from './bar'
import { Radio } from './visit'

type T = 'RESCHEDULE' | 'CANCEL' | 'HANDOVER'
const REASONS: Record<T, string[]> = {
  RESCHEDULE: ['Previous visit running late', 'Patient asked to move', 'Sick / emergency', 'Transport not available', 'Other'],
  CANCEL: ['Patient cancelled', 'Patient admitted to hospital', 'Patient not reachable', 'Duplicate request', 'Other'],
  HANDOVER: ['Sick / emergency', 'Skill mismatch', 'Clash with another visit', 'Too far', 'Other'],
}

export function ChangeForm({ id, requestNo, sub, slots, pending }: { id: string; requestNo: string; sub: string; slots: string[]; pending: { type: string; at: string; reason: string }[] }) {
  const router = useRouter()
  const toast = useToast()
  const [type, setType] = useState<T>('RESCHEDULE')
  const [reason, setReason] = useState(REASONS.RESCHEDULE[0])
  const [other, setOther] = useState('')
  const [slot, setSlot] = useState<string | null>(null)
  const [pickDate, setPickDate] = useState('')
  const [pickSlot, setPickSlot] = useState(slots[0] ?? '')
  const [note, setNote] = useState('')
  const [informed, setInformed] = useState(false)
  const [busy, setBusy] = useState(false)

  // quick slot proposals: remaining slots today, then tomorrow's
  const quick = useMemo(() => {
    const now = new Date()
    const hNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hour12: false }).format(now))
    const today = isoDay(now)
    const tomorrow = isoDay(new Date(now.getTime() + 86400_000))
    const out: { key: string; label: string; date: string; slot: string }[] = []
    for (const s of slots) if (Number(s.slice(0, 2)) > hNow) out.push({ key: `${today}|${s}`, label: `Today ${s}`, date: today, slot: s })
    for (const s of slots) out.push({ key: `${tomorrow}|${s}`, label: `Tomorrow ${s}`, date: tomorrow, slot: s })
    return out.slice(0, 3)
  }, [slots])

  const why = reason === 'Other' ? other.trim() : reason
  const proposed = type !== 'RESCHEDULE' ? null : slot === 'pick' ? (pickDate ? { date: pickDate, slot: pickSlot } : null) : quick.find((q) => q.key === slot) ?? null
  const ready = why.length >= 2

  async function send() {
    setBusy(true)
    try {
      await api(`/requests/${id}/change-request`, {
        body: { type, reason: why, proposedDate: proposed?.date, proposedSlot: proposed?.slot, note: note || undefined, patientInformed: informed },
      })
      toast('Sent to the coordinator for approval', 'ok')
      router.push(`/m/visits/${id}`)
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
      setBusy(false)
    }
  }

  return (
    <div className="min-w-0">
      <CHeader back={`/m/visits/${id}`} title="Can’t make this visit?" sub={sub} />
      <Body>
        {pending.length > 0 && (
          <div className="rounded-card bg-[#FEF3C7] px-4 py-3 text-[13px] text-[#B45309]">
            <b>Already waiting for the coordinator:</b>
            {pending.map((p, i) => (
              <div key={i}>
                {p.type.toLowerCase()} · {p.reason} · {p.at}
              </div>
            ))}
          </div>
        )}
        <Segmented<T>
          value={type}
          onChange={(t) => {
            setType(t)
            setReason(REASONS[t][0])
          }}
          items={[
            { value: 'RESCHEDULE', label: 'Reschedule' },
            { value: 'CANCEL', label: 'Cancel' },
            { value: 'HANDOVER', label: 'Hand over' },
          ]}
        />
        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-slate-700">
            Reason <span className="text-[#DC2626]">*</span>
          </div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white px-4 shadow-card">
            {REASONS[type].map((r) => (
              <Radio key={r} on={reason === r} label={r} onClick={() => setReason(r)} />
            ))}
          </div>
          {reason === 'Other' && <input autoFocus className="hc-input hc-input-lg mt-2" placeholder="Reason" value={other} onChange={(e) => setOther(e.target.value)} />}
        </div>

        {type === 'RESCHEDULE' && (
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Propose new slot</div>
            <div className="grid grid-cols-4 gap-2">
              {quick.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => setSlot(slot === q.key ? null : q.key)}
                  className={cx('flex min-h-12 items-center justify-center rounded-[10px] px-1 text-center text-[12px] font-bold leading-4', slot === q.key ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}
                >
                  {q.label}
                </button>
              ))}
              <button type="button" onClick={() => setSlot(slot === 'pick' ? null : 'pick')} className={cx('flex min-h-12 items-center justify-center rounded-[10px] text-[12px] font-bold', slot === 'pick' ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}>
                Pick
              </button>
            </div>
            {slot === 'pick' && (
              <div className="mt-2 grid grid-cols-[1fr_120px] gap-2">
                <input type="date" min={isoDay()} className="hc-input hc-input-lg" value={pickDate} onChange={(e) => setPickDate(e.target.value)} />
                <select className="hc-input hc-input-lg" value={pickSlot} onChange={(e) => setPickSlot(e.target.value)}>
                  {slots.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Note to coordinator</span>
          <textarea className="hc-input min-h-[64px] border-[1.5px] text-[15px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'RESCHEDULE' ? 'e.g. Running 40 min late from Banani, can reach by 17:15.' : 'Anything the coordinator should know'} />
        </label>
        <div className="flex items-center justify-between gap-3 rounded-card bg-white px-4 py-3 shadow-card">
          <span className="text-[14px] font-semibold">I have already informed the patient</span>
          <Toggle on={informed} onChange={setInformed} label="Patient informed" />
        </div>
        <div className="text-[12px] leading-[18px] text-slate-500">
          {requestNo} stays as it is until the coordinator approves. {type === 'RESCHEDULE' ? 'Once approved the visit moves to the new slot and is re-assigned.' : type === 'CANCEL' ? 'Cancellation is decided by the coordinator.' : 'The coordinator picks who takes over.'}
        </div>
      </Body>
      <BottomBar>
        <Link href={`/m/visits/${id}`} className={bigBtn('o')}>
          Back
        </Link>
        <button type="button" disabled={busy || !ready} onClick={send} className={bigBtn(ready ? 'p' : 'd', 'flex-[1.5]')}>
          {busy && <Loader2 size={18} className="animate-spin" />}
          Send to coordinator
        </button>
      </BottomBar>
    </div>
  )
}
