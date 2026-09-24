'use client'
// M05 visit detail islands: action bar (next step only), M06 accept/decline sheet, overflow menu,
// live timer widget, petty cash (S5) sheet.
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlarmClock,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  Loader2,
  LogIn,
  LogOut,
  MessageCircle,
  MessageSquareText,
  MoreVertical,
  Navigation,
  NotebookPen,
  Phone,
  Repeat2,
  Wallet,
  X,
} from 'lucide-react'
import { api, useAction, stamp, Sheet, Countdown, WhatsAppButton } from '@/components/client'
import { btnClass, Tag, telUrl } from '@/components/ui'
import { DECLINE_REASONS, PETTY_CASH_PURPOSES } from '@/lib/constants'
import { cx, time, relDay, mmss, taka, dur } from '@/lib/format'
import { sendOrQueue } from './live'

const svcName = (r: any) => (r.services ?? []).map((s: any) => s.name).join(' + ')
const ageG = (p: any) => [p?.ageYears, p?.gender].filter((x) => x != null && x !== '').join(' ')

// ---------------------------------------------------------------- radio row
export function Radio({ on, label, onClick, className }: { on: boolean; label: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex min-h-11 w-full items-center gap-3 text-left text-[15px] text-slate-900', className)}>
      <span className={cx('flex size-[22px] flex-none items-center justify-center rounded-full border-2', on ? 'border-primary' : 'border-slate-300')}>{on && <span className="size-2.5 rounded-full bg-primary" />}</span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------- M06 accept / decline
export function AcceptSheet({ r, open, onClose, primary, assignedBy }: { r: any; open: boolean; onClose: () => void; primary: boolean; assignedBy?: string | null }) {
  const { run, busy, router } = useAction()
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState(false)
  const respondBy = r.assignment?.respondBy
  const overdue = respondBy && new Date(respondBy).getTime() < Date.now()
  const transport =
    r.transport?.mode === 'UNICO_CAR' && r.vehicle ? `${r.vehicle.name} · pick-up ${time(r.transport.pickupAt)}` : r.transport?.needed ? (r.transport.status === 'REQUESTED' ? 'Car requested' : 'Own transport') : 'Own transport'
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="text-[20px] font-bold">New assignment</div>
          <div className="text-[13px] text-slate-500">
            {r.requestNo}
            {assignedBy ? ` · assigned by ${assignedBy}` : ''}
            {r.assignment?.assignedAt ? ` · ${time(r.assignment.assignedAt)}` : ''}
          </div>
        </div>
        {respondBy && (
          <span className={cx('inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[15px] font-bold', overdue ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#B45309]')}>
            <AlarmClock size={16} />
            <Countdown to={respondBy} />
          </span>
        )}
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-3 rounded-card bg-slate-100 p-3.5 text-[14px]">
        <Sum k="Patient" v={`${r.patientSnapshot?.name} · ${ageG(r.patientSnapshot)}`} />
        <Sum k="Service" v={`${svcName(r)} · ${r.expectedDurationMin ?? 45} min`} />
        <Sum k="Time" v={r.scheduledAt ? `${relDay(r.scheduledAt)} ${time(r.scheduledAt)}` : 'Not set'} />
        <Sum k="Transport" v={transport} />
        <Sum k="Address" v={r.patientSnapshot?.address || r.patientSnapshot?.area || '—'} className="col-span-2" />
        {r.assignment?.instructions && <Sum k="Instructions" v={r.assignment.instructions} className="col-span-2" />}
      </div>
      {primary ? (
        <>
          <div className={cx('mt-3.5 text-[13px] font-semibold', err ? 'text-[#B91C1C]' : 'text-slate-500')}>If declining, tell the coordinator why</div>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {DECLINE_REASONS.map((x) => (
              <Radio key={x} on={reason === x} label={x} onClick={() => (setReason(x), setErr(false))} />
            ))}
          </div>
          {reason && <textarea className="hc-input mt-2 min-h-[64px] text-[15px]" placeholder="Note to coordinator (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
        </>
      ) : (
        <div className="mt-3.5 text-[13px] text-slate-500">You are on the care team for this visit. Only the primary staff member can decline.</div>
      )}
      <div className="mt-3 flex gap-2.5 pb-[max(8px,env(safe-area-inset-bottom))]">
        {primary && (
          <button
            type="button"
            disabled={busy}
            className={btnClass('r', 'xl', 'flex-1')}
            onClick={async () => {
              if (!reason) return setErr(true)
              const ok = await run(() => api(`/requests/${r._id}/decline`, { body: { reason, note: note || undefined } }), 'Declined · the coordinator will reassign', { refresh: false })
              if (ok) router.replace('/m/visits')
            }}
          >
            Decline
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className={btnClass('p', 'xl', 'flex-[1.6]')}
          onClick={async () => {
            const ok = await run(() => api(`/requests/${r._id}/accept`, { body: { deviceAt: stamp().deviceAt } }), `Accepted · ${time(new Date())}`)
            if (ok) onClose()
          }}
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          Accept visit
        </button>
      </div>
    </Sheet>
  )
}

function Sum({ k, v, className }: { k: string; v: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">{k}</div>
      <div className="mt-0.5 font-semibold leading-5">{v}</div>
    </div>
  )
}

/** M04 inline respond row: "Respond in 09:12 · Decline · Accept" */
export function RespondInline({ r, primary }: { r: any; primary: boolean }) {
  const { run, busy } = useAction()
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex-1 text-[13px] font-semibold text-[#B45309]">
        {r.assignment?.respondBy ? (
          <>
            Respond in <Countdown to={r.assignment.respondBy} overdueClassName="text-[#B91C1C]" />
          </>
        ) : (
          'Awaiting your response'
        )}
      </div>
      {primary && (
        <button type="button" onClick={() => setOpen(true)} className="flex h-9 items-center rounded-xl border-[1.5px] border-slate-300 bg-white px-3.5 text-[14px] font-bold text-slate-700">
          Decline
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => api(`/requests/${r._id}/accept`, { body: { deviceAt: stamp().deviceAt } }), `Accepted ${r.requestNo}`)}
        className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-[14px] font-bold text-white disabled:opacity-60"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        Accept
      </button>
      <AcceptSheet r={r} open={open} onClose={() => setOpen(false)} primary={primary} />
    </>
  )
}

// ---------------------------------------------------------------- bottom action bar (next step only)
export function VisitActionBar({
  r,
  team,
  primary,
  assignedBy,
  missing,
  ckDone,
  ckTotal,
  autoRespond,
  canFollowUp,
}: {
  r: any
  team: boolean
  primary: boolean
  assignedBy?: string | null
  missing: number
  ckDone: number
  ckTotal: number
  autoRespond?: boolean
  canFollowUp?: boolean
}) {
  const router = useRouter()
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [journey, setJourney] = useState<string | null>(null)
  const { toast } = useAction()
  useEffect(() => {
    if (autoRespond && r.status === 'ASSIGNED' && team) setSheet(true)
  }, [autoRespond, r.status, team])

  const id = r._id
  const chat = (
    <Link href={`/m/visits/${id}/chat`} className="flex size-[52px] flex-none items-center justify-center rounded-xl border-[1.5px] border-slate-300 text-primary-700" aria-label="Chat with coordinator">
      <MessageCircle size={22} />
    </Link>
  )
  const big = 'flex h-[52px] flex-1 items-center justify-center gap-2 rounded-xl text-base font-bold text-white'
  let main: ReactNode = null
  if (team) {
    if (r.status === 'ASSIGNED')
      main = (
        <button type="button" onClick={() => setSheet(true)} className={cx(big, 'bg-primary')}>
          Respond · accept or decline
        </button>
      )
    else if (r.status === 'ACCEPTED')
      main = (
        <button
          type="button"
          disabled={busy}
          className={cx(big, 'bg-primary disabled:opacity-60')}
          onClick={async () => {
            setBusy(true)
            try {
              const at = new Date()
              const res = await sendOrQueue(`/requests/${id}/en-route`, stamp(), { label: 'Start journey' })
              toast(res.queued ? `Journey start saved offline · ${time(at)}` : `Journey started · ${time(at)}`, 'ok')
              setJourney(time(at))
              router.refresh()
            } catch (e: any) {
              toast(e.message, 'err')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Navigation size={18} />}
          Start journey
        </button>
      )
    else if (r.status === 'EN_ROUTE')
      main = (
        <Link href={`/m/visits/${id}/checkin`} className={cx(big, 'bg-primary')}>
          <LogIn size={18} /> Check in
        </Link>
      )
    else if (r.status === 'IN_PROGRESS')
      main = missing ? (
        <Link href={`/m/visits/${id}/checklist`} className={cx(big, 'bg-primary')}>
          Continue checklist · {ckDone}/{ckTotal} <ChevronRight size={20} />
        </Link>
      ) : (
        <Link href={`/m/visits/${id}/checkout`} className={cx(big, 'bg-[#16A34A]')}>
          <LogOut size={18} /> Check out
        </Link>
      )
    else if (['COMPLETED', 'CLOSED'].includes(r.status) && canFollowUp)
      main = (
        <Link href={`/m/new-request?patientId=${r.patientId}&from=${id}`} className={cx(big, 'bg-primary')}>
          <Repeat2 size={18} /> Request follow-up
        </Link>
      )
  }
  return (
    <>
      <div className="flex w-full gap-2.5">
        {chat}
        {main ?? (
          <Link href={`/m/visits/${id}/chat`} className={cx(big, 'bg-primary')}>
            Open chat
          </Link>
        )}
      </div>
      {team && r.status === 'ASSIGNED' && <AcceptSheet r={r} open={sheet} onClose={() => setSheet(false)} primary={primary} assignedBy={assignedBy} />}
      <Sheet open={!!journey} onClose={() => setJourney(null)} title={`Journey started · ${journey}`} sub="Let the patient know you are on the way (WhatsApp opens with the message ready).">
        <div className="flex flex-col gap-2.5 pb-3">
          <WhatsAppButton requestId={id} templateKey="patient_en_route" kind="g" size="xl" className="w-full">
            Send “on the way” on WhatsApp
          </WhatsAppButton>
          <button type="button" onClick={() => setJourney(null)} className={btnClass('o', 'xl', 'w-full')}>
            Skip
          </button>
        </div>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------- overflow menu
export function OverflowMenu({ r, team, canFollowUp, coordinatorPhone }: { r: any; team: boolean; canFollowUp: boolean; coordinatorPhone?: string | null }) {
  const [open, setOpen] = useState(false)
  const id = r._id
  const active = !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)
  const Row = ({ href, icon: I, label, sub }: { href: string; icon: any; label: string; sub?: string }) => (
    <Link href={href} onClick={() => setOpen(false)} className="flex min-h-[52px] items-center gap-3 border-t border-slate-100 py-2 first:border-t-0">
      <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-primary-50 text-primary-700">
        <I size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        {sub && <span className="block text-[12px] text-slate-500">{sub}</span>}
      </span>
      <ChevronRight size={18} className="text-slate-400" />
    </Link>
  )
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex size-10 flex-none items-center justify-center text-slate-700" aria-label="More actions">
        <MoreVertical size={22} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Visit actions" sub={`${r.requestNo} · ${r.patientSnapshot?.name}`}>
        <div className="pb-2">
          <Row href={`/m/visits/${id}/chat`} icon={MessageSquareText} label="Chat with coordinator" sub="Thread for this visit" />
          <Row href={`/m/visits/${id}/rx`} icon={FlaskConical} label="Prescription & results" sub="e-Rx and lab results" />
          {team && active && <Row href={`/m/visits/${id}/change`} icon={CalendarClock} label="Request reschedule / cancel / hand over" sub="Goes to the coordinator for approval" />}
          {canFollowUp && <Row href={`/m/new-request?patientId=${r.patientId}&from=${id}`} icon={Repeat2} label="Request follow-up" sub="New request for this patient" />}
          <Row href={`/m/notes?requestId=${id}`} icon={NotebookPen} label="Add note" sub="Shared with the team or coordinator" />
          {team && r.status === 'IN_PROGRESS' && <Row href={`/m/visits/${id}/notes`} icon={ClipboardList} label="Visit notes & medications" />}
          {coordinatorPhone && (
            <a href={telUrl(coordinatorPhone)} className="flex min-h-[52px] items-center gap-3 border-t border-slate-100 py-2">
              <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-primary-50 text-primary-700">
                <Phone size={18} />
              </span>
              <span className="flex-1 text-[15px] font-semibold">Call coordinator</span>
            </a>
          )}
          {team && active && (
            <div className="mt-2 border-t border-slate-100 pt-3">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Send WhatsApp to patient</div>
              <div className="flex gap-2">
                <WhatsAppButton requestId={id} templateKey="patient_en_route" kind="o" size="lg" className="flex-1 !px-2 text-[14px]">
                  On the way
                </WhatsAppButton>
                <WhatsAppButton requestId={id} templateKey="patient_arrived" kind="o" size="lg" className="flex-1 !px-2 text-[14px]">
                  Arrived
                </WhatsAppButton>
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------- live timer (M05-c header)
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function TimerWidget({ checkInAt, scheduledAt, plannedMin, lateMin, overtimePct = 25, lateAfter = 10 }: { checkInAt: string; scheduledAt?: string; plannedMin: number; lateMin?: number | null; overtimePct?: number; lateAfter?: number }) {
  const now = useNow()
  const sec = Math.max(0, (now - new Date(checkInAt).getTime()) / 1000)
  const min = sec / 60
  const h = Math.floor(sec / 3600)
  const over = min > plannedMin * (1 + overtimePct / 100)
  const past = min > plannedMin
  const late = (lateMin ?? 0) > lateAfter
  const pct = Math.min(100, (min / plannedMin) * 100)
  return (
    <div className="rounded-card bg-primary px-4 py-3.5 text-white shadow-[0_8px_20px_rgba(0,144,202,.28)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[.06em] opacity-80">Elapsed</div>
          <div className="text-[40px] font-bold leading-[44px] tracking-[-.01em]">{h ? `${h}:${mmss(sec % 3600)}` : mmss(sec)}</div>
        </div>
        <div className="pb-1 text-right text-[13px] leading-5">
          <div className="opacity-90">
            Scheduled {scheduledAt ? time(scheduledAt) : '—'} · {plannedMin} min
          </div>
          <div className="font-semibold">
            Checked in {time(checkInAt)} · {lateMin != null ? (late ? `${lateMin} min late` : lateMin > 0 ? `+${lateMin} min · on time` : 'on time') : ''}
          </div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
        <div className={cx('h-full rounded-full', over ? 'bg-[#FCA5A5]' : past ? 'bg-[#FCD34D]' : 'bg-white')} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="opacity-90">
          Planned {dur(plannedMin)} · actual {dur(min)}
        </span>
        <span className="flex-1" />
        {late && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-bold text-[#B45309]">Late start</span>}
        {over ? (
          <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 font-bold text-[#B91C1C]">Overtime +{Math.round(min - plannedMin)} min</span>
        ) : past ? (
          <span className="rounded-full bg-white/20 px-2 py-0.5 font-bold">Over plan</span>
        ) : (
          <span className="rounded-full bg-white/20 px-2 py-0.5 font-bold">{Math.round(plannedMin - min)} min left</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- petty cash (S5)
const PC_TONE = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red' } as const

export function PettyCash({ r, team }: { r: any; team: boolean }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState<string>(PETTY_CASH_PURPOSES[0])
  const [note, setNote] = useState('')
  const { run, busy } = useAction()
  const list: any[] = r.pettyCash ?? []
  const active = !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)
  return (
    <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-[#FEF3C7] text-[#B45309]">
          <Wallet size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Petty cash</div>
          <div className="text-[12px] text-slate-500">{list.length ? `${list.length} request${list.length === 1 ? '' : 's'} · ${taka(list.reduce((a, p) => a + (p.amount ?? 0), 0))}` : 'Consumables, transport top-up…'}</div>
        </div>
        {team && active && (
          <button type="button" onClick={() => setOpen(true)} className="flex h-10 items-center rounded-[10px] bg-primary-50 px-3.5 text-[14px] font-bold text-primary-700">
            Request
          </button>
        )}
      </div>
      {list.length > 0 && (
        <div className="mt-2.5 divide-y divide-slate-100 border-t border-slate-100">
          {list.map((p) => (
            <div key={p._id} className="flex items-center gap-2 py-2 text-[13px]">
              <span className="font-bold">{taka(p.amount)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">
                {p.purpose}
                {p.note ? ` · ${p.note}` : ''} · {time(p.requestedAt)}
              </span>
              <Tag tone={PC_TONE[p.status as 'PENDING'] ?? 'slate'}>{p.status}</Tag>
            </div>
          ))}
        </div>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Petty cash request"
        sub={`Goes to the coordinator for approval · ${r.requestNo}`}
        footer={
          <>
            <button type="button" className={btnClass('o', 'xl', 'flex-1')} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !Number(amount)}
              className={btnClass('p', 'xl', 'flex-[1.4]')}
              onClick={async () => {
                const ok = await run(() => api(`/requests/${r._id}/petty-cash`, { body: { amount: Number(amount), purpose, note: note || undefined } }), 'Petty cash request sent')
                if (ok) {
                  setOpen(false)
                  setAmount('')
                  setNote('')
                }
              }}
            >
              {busy && <Loader2 size={18} className="animate-spin" />}
              Send request
            </button>
          </>
        }
      >
        <label className="block">
          <span className="hc-label text-[13px]">
            Amount needed <span className="text-[#DC2626]">*</span>
          </span>
          <div className="flex h-14 items-center gap-1.5 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 focus-within:border-primary">
            <span className="text-[22px] font-bold text-slate-500">৳</span>
            <input
              inputMode="numeric"
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-[22px] font-bold outline-none"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <span className="mt-1.5 block text-[12px] text-slate-500">Numbers only</span>
        </label>
        <div className="mt-3.5">
          <div className="hc-label text-[13px]">For</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {PETTY_CASH_PURPOSES.map((p) => (
              <button key={p} type="button" onClick={() => setPurpose(p)} className={cx('h-9 flex-none rounded-full px-3.5 text-[13px] font-semibold', p === purpose ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <label className="mt-3.5 block pb-2">
          <span className="hc-label text-[13px]">Note</span>
          <input className="hc-input hc-input-lg" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Sheet>
    </div>
  )
}

export function CloseX({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex size-9 items-center justify-center rounded-lg text-slate-500" aria-label="Close">
      <X size={18} />
    </button>
  )
}
