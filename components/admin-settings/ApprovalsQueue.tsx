'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserPlus, CalendarClock, Zap, LayoutGrid, UserCog, X, ArrowRightLeft, Loader2, MessageSquareText, CircleCheck, ArrowRight } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { Avatar, btnClass, Tag } from '@/components/ui'
import { ROLE_LABEL, type Role } from '@/lib/constants'
import { ago, cx, dateTime, taka } from '@/lib/format'

export type ApprovalRow = {
  _id: string
  type: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reason?: string
  note?: string
  payload?: Record<string, any>
  createdAt: string
  decidedAt?: string
  decisionNote?: string
  requester?: { id: string; name: string; role: string } | null
  user?: { id: string; name: string; role: string; employeeId: string; status: string } | null
  decider?: { id: string; name: string } | null
  request?: { id: string; requestNo: string; status: string; scheduledAt?: string; slot?: string; patient?: string; service?: string } | null
}

const META: Record<string, { label: string; icon: ReactNode; approve: string; reject: string }> = {
  NEW_USER: { label: 'New user request', icon: <UserPlus size={18} />, approve: 'Approve', reject: 'Reject' },
  ROLE_CHANGE: { label: 'Role change', icon: <UserCog size={18} />, approve: 'Approve', reject: 'Reject' },
  RESCHEDULE: { label: 'Reschedule request', icon: <CalendarClock size={18} />, approve: 'Approve', reject: 'Decline' },
  CANCEL: { label: 'Cancellation', icon: <X size={18} />, approve: 'Approve · cancel visit', reject: 'Keep visit' },
  HANDOVER: { label: 'Handover request', icon: <ArrowRightLeft size={18} />, approve: 'Approve · reassign', reject: 'Decline' },
  PETTY_CASH: { label: 'Petty cash', icon: <Zap size={18} />, approve: 'Approve', reject: 'Reject' },
  SERVICE_PROPOSAL: { label: 'New service proposed', icon: <LayoutGrid size={18} />, approve: 'Approve', reject: 'Reject' },
}

function summary(a: ApprovalRow): ReactNode {
  const p = a.payload ?? {}
  const by = a.requester?.name ?? 'Unknown'
  const req = a.request ? (
    <Link href={`/requests/${a.request.id}`} className="font-semibold text-primary-700 hover:underline">
      {a.request.requestNo}
    </Link>
  ) : null
  const dot = <span className="text-slate-300"> · </span>
  switch (a.type) {
    case 'NEW_USER':
      return (
        <>
          {a.user ? (
            <Link href={`/staff?q=${encodeURIComponent(a.user.employeeId)}`} className="font-semibold text-primary-700 hover:underline">
              {a.user.name}
            </Link>
          ) : (
            (p.name ?? 'User')
          )}
          {dot}
          <span className="font-mono text-[11.5px]">{a.user?.role ?? p.role}</span>
          {a.user?.employeeId && (
            <>
              {dot}
              {a.user.employeeId}
            </>
          )}
          {dot}added by {by}
        </>
      )
    case 'PETTY_CASH':
      return (
        <>
          <b className="text-slate-800">{taka(p.amount)}</b>
          {dot}
          {String(p.purpose ?? '').toLowerCase()}
          {dot}
          {by}
          {req && (
            <>
              {dot}
              {req}
            </>
          )}
        </>
      )
    case 'RESCHEDULE':
      return (
        <>
          {req}
          {a.request?.patient && (
            <>
              {dot}
              {a.request.patient}
            </>
          )}
          {dot}
          {by}
          {a.reason && (
            <>
              {dot}“{a.reason}”
            </>
          )}
          {(p.proposedDate || p.proposedSlot) && (
            <>
              {' '}
              → <b className="text-slate-800">{[p.proposedDate, p.proposedSlot].filter(Boolean).join(' ')}</b>
            </>
          )}
          {p.patientInformed && (
            <>
              {dot}patient informed
            </>
          )}
        </>
      )
    case 'CANCEL':
    case 'HANDOVER':
      return (
        <>
          {req}
          {a.request?.patient && (
            <>
              {dot}
              {a.request.patient}
            </>
          )}
          {dot}
          {by}
          {a.reason && (
            <>
              {dot}“{a.reason}”
            </>
          )}
        </>
      )
    case 'SERVICE_PROPOSAL':
      return (
        <>
          “{p.name ?? 'New service'}”{p.durationMin ? ` · ${p.durationMin} min` : ''}
          {p.fee != null && ` · ${taka(p.fee)}`}
          {dot}by {by}
          {a.reason && (
            <>
              {dot}
              {a.reason}
            </>
          )}
        </>
      )
    case 'ROLE_CHANGE':
      return (
        <>
          {a.user?.name ?? p.name ?? 'User'}
          {dot}
          {p.from ?? a.user?.role} → {p.to ?? p.role ?? p.change ?? 'change'}
          {dot}by {by}
          {a.reason && (
            <>
              {dot}
              {a.reason}
            </>
          )}
        </>
      )
    default:
      return a.reason ?? by
  }
}

export function ApprovalsQueue({ items, canUsers }: { items: ApprovalRow[]; canUsers: boolean }) {
  const [done, setDone] = useState<{ id: string; text: string; href?: string; hrefLabel?: string; approved: boolean }[]>([])
  const hidden = new Set(done.map((d) => d.id))
  const rows = items.filter((a) => !hidden.has(a._id) || a.status !== 'PENDING')
  return (
    <div className="flex flex-col gap-2.5">
      {done.map((d) => (
        <div key={d.id} className={cx('flex items-center gap-2.5 rounded-card px-4 py-3 text-[13px]', d.approved ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-slate-100 text-slate-700')}>
          <CircleCheck size={16} className="flex-none" />
          <span className="flex-1">{d.text}</span>
          {d.href && (
            <Link href={d.href} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
              {d.hrefLabel} <ArrowRight size={14} />
            </Link>
          )}
          <button type="button" className="text-current/60 hover:text-current" onClick={() => setDone((x) => x.filter((y) => y.id !== d.id))} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
      {rows.map((a) => (
        <ApprovalCard key={a._id} a={a} locked={!canUsers && (a.type === 'NEW_USER' || a.type === 'ROLE_CHANGE')} onDecided={(d) => setDone((x) => [d, ...x])} />
      ))}
    </div>
  )
}

function ApprovalCard({ a, locked, onDecided }: { a: ApprovalRow; locked?: boolean; onDecided: (d: { id: string; text: string; href?: string; hrefLabel?: string; approved: boolean }) => void }) {
  const router = useRouter()
  const toast = useToast()
  const m = META[a.type] ?? { label: a.type, icon: <CircleCheck size={18} />, approve: 'Approve', reject: 'Reject' }
  const [busy, setBusy] = useState<'a' | 'r' | null>(null)
  const [more, setMore] = useState(false)
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState<string>(a.payload?.proposedSlot ?? '')
  const pending = a.status === 'PENDING'
  const needsSlot = a.type === 'RESCHEDULE' && !a.payload?.proposedDate
  const approveLabel = a.type === 'RESCHEDULE' ? (a.payload?.proposedDate || date ? 'Approve · reschedule' : 'Approve') : m.approve

  async function decide(approve: boolean) {
    setBusy(approve ? 'a' : 'r')
    try {
      const r = await api<{ status: string; followUp?: string }>(`/approvals/${a._id}`, { method: 'PATCH', body: { approve, note: note.trim() || undefined, ...(approve && date ? { date, slot: slot || undefined } : {}) } })
      const what = `${m.label}${a.request ? ` · ${a.request.requestNo}` : a.user ? ` · ${a.user.name}` : ''}`
      let hrefLabel: string | undefined
      if (r.followUp?.includes('reschedule=1')) hrefLabel = 'Pick the new slot'
      else if (r.followUp?.includes('assign=1')) hrefLabel = a.type === 'HANDOVER' ? 'Reassign now' : 'Assign staff'
      else if (r.followUp?.startsWith('/staff')) hrefLabel = 'Open user'
      else if (r.followUp?.startsWith('/settings/services')) hrefLabel = 'Create the service'
      else if (r.followUp) hrefLabel = 'Open request'
      onDecided({ id: a._id, text: `${approve ? 'Approved' : 'Rejected'}: ${what}. The requester was notified.`, href: r.followUp, hrefLabel, approved: approve })
      toast(approve ? 'Approved' : 'Rejected')
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Failed', 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-card bg-white px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-slate-100 text-slate-600">{m.icon}</div>
        <div className="min-w-0 flex-1 basis-[320px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold">{m.label}</span>
            {!pending && <Tag tone={a.status === 'APPROVED' ? 'green' : 'red'}>{a.status}</Tag>}
            {a.request?.status && pending && <span className="text-[11.5px] text-slate-400">request {a.request.status.toLowerCase().replace('_', ' ')}</span>}
          </div>
          <div className="text-[13px] leading-5 text-slate-500">{summary(a)}</div>
          {a.note && <div className="mt-0.5 text-[12.5px] italic text-slate-500">“{a.note}”</div>}
          {!pending && (
            <div className="mt-1 text-[12px] text-slate-500">
              {a.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {a.decider?.name ?? '—'} · {dateTime(a.decidedAt)}
              {a.decisionNote ? ` · “${a.decisionNote}”` : ''}
            </div>
          )}
        </div>
        <div className="flex flex-none items-center gap-2" title={a.requester ? `${a.requester.name} · ${ROLE_LABEL[a.requester.role as Role] ?? a.requester.role}` : undefined}>
          {a.requester && <Avatar name={a.requester.name} size={28} tone="slate" />}
          <span className="whitespace-nowrap text-[12.5px] text-slate-400">{ago(a.createdAt)}</span>
        </div>
        {pending && locked && <span className="flex-none rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-600">Super admin decides</span>}
        {pending && !locked && (
          <div className="flex flex-none items-center gap-2">
            <button type="button" onClick={() => setMore((x) => !x)} className={cx('inline-flex size-[38px] items-center justify-center rounded-lg border-[1.5px] text-slate-600', more ? 'border-primary text-primary-700' : 'border-slate-300')} title="Add a note" aria-label="Add a note">
              <MessageSquareText size={16} />
            </button>
            <button type="button" className={btnClass('p')} disabled={!!busy} onClick={() => decide(true)}>
              {busy === 'a' && <Loader2 size={16} className="animate-spin" />}
              {approveLabel}
            </button>
            <button type="button" className={btnClass('o')} disabled={!!busy} onClick={() => decide(false)}>
              {busy === 'r' && <Loader2 size={16} className="animate-spin" />}
              {m.reject}
            </button>
          </div>
        )}
      </div>
      {pending && !locked && (more || needsSlot) && (
        <div className="ml-0 mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:ml-[54px] sm:grid-cols-[1fr_auto]">
          {more && (
            <label className="block">
              <span className="hc-label">Note to the requester (optional)</span>
              <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Keep the receipt for accounts" />
            </label>
          )}
          {needsSlot && (
            <div className={cx('flex flex-wrap items-end gap-2', !more && 'sm:col-span-2')}>
              <label className="block">
                <span className="hc-label">New date {a.payload?.proposedSlot ? `(proposed slot ${a.payload.proposedSlot})` : ''}</span>
                <input type="date" className="hc-input w-[170px]" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="block">
                <span className="hc-label">Slot</span>
                <input className="hc-input w-[96px]" value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="17–19" />
              </label>
              <span className="pb-2.5 text-[12px] text-slate-500">{date ? 'Approving reschedules the visit now' : 'Leave empty to approve and pick the slot on the request'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
