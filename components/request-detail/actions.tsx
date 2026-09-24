'use client'
// W04 header action bar + lifecycle dialogs (confirm, reschedule, cancel, close / invoice, email, WhatsApp, edit).
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { CalendarClock, CheckCircle2, FileText, Loader2, Mail, MessageCircle, Pencil, RefreshCw, ShieldCheck, UserPlus, Users, AlertTriangle, Check, Search } from 'lucide-react'
import { api, useAction, ActionButton, Drawer, Segmented, Toggle, ChipPicker, WhatsAppButton } from '@/components/client'
import { btnClass, Avatar } from '@/components/ui'
import { TESTS_PROCEDURES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Status } from '@/lib/constants'
import { cx, taka } from '@/lib/format'
import { availableActions, type Perms } from './lib'
import { AssignDrawer, type AssignProps } from '@/components/assign/AssignDrawer'

export type ReqLite = {
  id: string
  requestNo: string
  status: Status
  version: number
  priority: string
  tests: string[]
  date: string // YYYY-MM-DD (scheduled or preferred)
  time: string // HH:mm
  slot: string
  expectedDurationMin: number
  estimatedFee: number | null
  paymentMethod: string | null
  transportNeeded: boolean
  uhid: string
  patientName: string
  patientEmail: string | null
  primaryStaffId: string | null
  primaryStaffName: string | null
  complaint: string
  instructions: string
  remarks: string
  rescheduled: boolean
  billing: { billAmount: number | null; status: string | null; method: string | null; invoiceNo: string; invoiceAmount: number | null; invoicePrinted: boolean | null }
  pettyCash: { id: string; amount: number; purpose: string; by: string; byInitials: string; at: string | null; status: string }[]
  summary: { team: string; time: string; tests: string; transport: string; report: string }
}

// ---------------------------------------------------------------- tiny form helpers
function F({ label, req, children, className }: { label: string; req?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="hc-label">
        {label}
        {req && <span className="text-[#DC2626]"> *</span>}
      </span>
      {children}
    </label>
  )
}

function SlotSelect({ value, onChange, slots }: { value: string; onChange: (v: string) => void; slots: string[] }) {
  return (
    <select className="hc-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No slot</option>
      {slots.map((s) => (
        <option key={s} value={s}>
          {s.replace(/^(\d\d)–(\d\d)$/, '$1:00 – $2:00')}
        </option>
      ))}
    </select>
  )
}

function Foot({ onClose, children, note }: { onClose: () => void; children: ReactNode; note?: ReactNode }) {
  return (
    <>
      {note && <span className="mr-auto text-[12px] text-slate-500">{note}</span>}
      <button type="button" className={btnClass('o', 'md', note ? '' : 'ml-auto')} onClick={onClose}>
        Cancel
      </button>
      {children}
    </>
  )
}

const iconBtn = (kind: 'o' | 'p' | 'g' | 'r' = 'o') => btnClass(kind, 'md', 'h-9')

// ---------------------------------------------------------------- action bar
export function ActionBar({
  r,
  perms,
  slots,
  assign,
  assignOpen,
  reportHref,
}: {
  r: ReqLite
  perms: Perms
  slots: string[]
  assign: Omit<AssignProps, 'open' | 'onClose'> | null
  assignOpen: boolean
  reportHref: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [dlg, setDlg] = useState<null | 'confirm' | 'reschedule' | 'cancel' | 'close' | 'email' | 'whatsapp'>(null)
  const [assigning, setAssigning] = useState(assignOpen)
  useEffect(() => setAssigning(assignOpen), [assignOpen])
  const a = availableActions(r.status)
  const close = () => setDlg(null)
  const closeAssign = () => {
    setAssigning(false)
    if (sp.get('assign')) {
      const q = new URLSearchParams(sp.toString())
      q.delete('assign')
      router.replace(`${pathname}${q.size ? `?${q}` : ''}`, { scroll: false })
    }
  }
  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {perms.manage && a.verify && (
          <ActionButton path={`/requests/${r.id}/verify`} kind="o" className="h-9" success="Request verified">
            <ShieldCheck size={16} /> Verify
          </ActionButton>
        )}
        {perms.manage && a.confirm && (
          <button className={iconBtn('p')} onClick={() => setDlg('confirm')}>
            <CheckCircle2 size={16} /> Confirm
          </button>
        )}
        {perms.assign && a.assign && assign && (
          <button className={iconBtn('p')} onClick={() => setAssigning(true)}>
            <UserPlus size={16} /> Assign
          </button>
        )}
        {(perms.manage || perms.invoice) && a.close && (
          <button className={iconBtn(perms.manage ? 'g' : 'o')} onClick={() => setDlg('close')}>
            <CheckCircle2 size={16} /> {perms.manage ? 'Close visit' : 'Invoice'}
          </button>
        )}
        {perms.send && (
          <button className={iconBtn()} onClick={() => setDlg('email')}>
            <Mail size={16} /> Send email
          </button>
        )}
        {perms.send && (
          <button className={iconBtn()} onClick={() => setDlg('whatsapp')}>
            <MessageCircle size={16} /> Send WhatsApp
          </button>
        )}
        {reportHref && (
          <a href={reportHref} target="_blank" rel="noreferrer" className={iconBtn()}>
            <FileText size={16} /> Visit report
          </a>
        )}
        {perms.manage && a.reschedule && (
          <button className={iconBtn()} onClick={() => setDlg('reschedule')}>
            <CalendarClock size={16} /> Reschedule
          </button>
        )}
        {perms.assign && a.reassign && assign && (
          <button className={iconBtn()} onClick={() => setAssigning(true)}>
            <Users size={16} /> Reassign
          </button>
        )}
        {perms.manage && a.cancel && (
          <button className={iconBtn('r')} onClick={() => setDlg('cancel')}>
            Cancel
          </button>
        )}
      </div>
      {dlg === 'confirm' && <ConfirmDialog r={r} slots={slots} onClose={close} />}
      {dlg === 'reschedule' && <RescheduleDialog r={r} slots={slots} onClose={close} />}
      {dlg === 'cancel' && <CancelDialog r={r} onClose={close} />}
      {dlg === 'close' && <CloseDialog r={r} perms={perms} onClose={close} />}
      {dlg === 'email' && <EmailDialog r={r} onClose={close} />}
      {dlg === 'whatsapp' && <WhatsAppDialog r={r} onClose={close} />}
      {assign && <AssignDrawer {...assign} open={assigning} onClose={closeAssign} />}
    </>
  )
}

// ---------------------------------------------------------------- confirm
function ConfirmDialog({ r, slots, onClose }: { r: ReqLite; slots: string[]; onClose: () => void }) {
  const { run, busy } = useAction()
  const [f, setF] = useState({
    date: r.date,
    time: r.time,
    slot: r.slot,
    uhid: r.uhid,
    tests: r.tests,
    estimatedFee: r.estimatedFee?.toString() ?? '',
    priority: r.priority,
    transportNeeded: r.transportNeeded,
    expectedDurationMin: String(r.expectedDurationMin || 45),
  })
  const [lookup, setLookup] = useState<null | { busy?: boolean; text: string; tone: 'ok' | 'warn' }>(null)
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }))
  async function findUhid() {
    if (!f.uhid.trim()) return
    setLookup({ busy: true, text: 'Looking up…', tone: 'ok' })
    try {
      const res = await api<{ items: any[] }>(`/patients?q=${encodeURIComponent(f.uhid.trim())}&limit=5`)
      const hit = res.items.find((p) => (p.uhid ?? '').toLowerCase() === f.uhid.trim().toLowerCase())
      if (!hit) setLookup({ text: 'No patient has this UHID yet — it will be saved to this patient.', tone: 'ok' })
      else if (hit.name === r.patientName) setLookup({ text: `Matches ${hit.name} · ${hit.phone}`, tone: 'ok' })
      else setLookup({ text: `UHID already belongs to ${hit.name} · ${hit.phone}. Check before confirming.`, tone: 'warn' })
    } catch (e: any) {
      setLookup({ text: e.message, tone: 'warn' })
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title="Confirm request"
      sub={`${r.requestNo} · ${r.patientName} · slot and fee agreed with the patient`}
      footer={
        <Foot onClose={onClose} note="Patient is emailed if they have an address">
          <button
            className={btnClass('p')}
            disabled={busy || !f.date}
            onClick={async () => {
              const ok = await run(
                () =>
                  api(`/requests/${r.id}/confirm`, {
                    body: {
                      date: f.date,
                      time: f.time || undefined,
                      slot: f.slot || undefined,
                      uhid: f.uhid.trim() || undefined,
                      tests: f.tests,
                      estimatedFee: f.estimatedFee === '' ? undefined : Number(f.estimatedFee),
                      priority: f.priority,
                      transportNeeded: f.transportNeeded,
                      expectedDurationMin: Number(f.expectedDurationMin) || undefined,
                    },
                  }),
                'Request confirmed',
              )
              if (ok) onClose()
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirm
          </button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2.5">
          <F label="Date of service" req>
            <input type="date" className="hc-input" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </F>
          <F label="Time">
            <input type="time" className="hc-input" value={f.time} onChange={(e) => set('time', e.target.value)} />
          </F>
          <F label="Slot">
            <SlotSelect value={f.slot} onChange={(v) => set('slot', v)} slots={slots} />
          </F>
        </div>
        <F label="UHID / MRN">
          <div className="flex gap-2">
            <input className="hc-input" value={f.uhid} placeholder="e.g. 104582" onChange={(e) => (set('uhid', e.target.value), setLookup(null))} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), findUhid())} />
            <button type="button" className={btnClass('o', 'md', 'h-10')} onClick={findUhid}>
              {lookup?.busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Look up
            </button>
          </div>
          {lookup && !lookup.busy && <div className={cx('mt-1.5 text-[12px] font-semibold', lookup.tone === 'ok' ? 'text-[#15803D]' : 'text-[#B45309]')}>{lookup.text}</div>}
        </F>
        <div>
          <span className="hc-label">Priority</span>
          <Segmented
            items={[
              { value: 'ROUTINE', label: 'Routine' },
              { value: 'URGENT', label: 'Urgent' },
              { value: 'EMERGENCY', label: 'Emergency' },
            ]}
            value={f.priority}
            onChange={(v) => set('priority', v)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <F label="Estimated fee (৳)">
            <input type="number" min={0} className="hc-input" value={f.estimatedFee} onChange={(e) => set('estimatedFee', e.target.value)} />
          </F>
          <F label="Expected duration (min)">
            <input type="number" min={5} step={5} className="hc-input" value={f.expectedDurationMin} onChange={(e) => set('expectedDurationMin', e.target.value)} />
          </F>
        </div>
        <div>
          <span className="hc-label">Tests / procedures {f.tests.length > 0 && <span className="text-slate-500">· {f.tests.length} selected</span>}</span>
          <div className="max-h-[260px] overflow-y-auto rounded-lg border border-slate-200 p-2.5">
            <ChipPicker options={[...TESTS_PROCEDURES]} value={f.tests} onChange={(v) => set('tests', v)} />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="text-[13px]">
            <b>Transport needed</b> <span className="text-slate-500">· Unico @ Home car, notifies the car supervisor</span>
          </div>
          <Toggle on={f.transportNeeded} onChange={(v) => set('transportNeeded', v)} label="Transport needed" />
        </div>
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------- reschedule
function RescheduleDialog({ r, slots, onClose }: { r: ReqLite; slots: string[]; onClose: () => void }) {
  const { run, busy } = useAction()
  const [f, setF] = useState({ date: r.date, time: '', slot: r.slot, reason: '' })
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Drawer
      open
      onClose={onClose}
      title="Reschedule visit"
      sub={`${r.requestNo} · ${r.patientName}`}
      footer={
        <Foot onClose={onClose} note={r.primaryStaffName ? 'The team is released and must be re-assigned' : undefined}>
          <button
            className={btnClass('p')}
            disabled={busy || !f.date || f.reason.trim().length < 2}
            onClick={async () => {
              const ok = await run(() => api(`/requests/${r.id}/reschedule`, { body: { date: f.date, time: f.time || undefined, slot: f.slot || undefined, reason: f.reason.trim() } }), 'Visit rescheduled')
              if (ok) onClose()
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />} Reschedule
          </button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2.5">
          <F label="New date" req>
            <input type="date" className="hc-input" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </F>
          <F label="Slot">
            <SlotSelect value={f.slot} onChange={(v) => set('slot', v)} slots={slots} />
          </F>
          <F label="Exact time">
            <input type="time" className="hc-input" value={f.time} onChange={(e) => set('time', e.target.value)} />
          </F>
        </div>
        <F label="Reason" req>
          <textarea className="hc-input" rows={3} value={f.reason} placeholder="e.g. Patient asked for the evening slot" onChange={(e) => set('reason', e.target.value)} />
        </F>
        {r.primaryStaffName && (
          <div className="flex gap-2 rounded-lg bg-[#FFF7ED] px-3 py-2.5 text-[13px] text-[#9A3412]">
            <AlertTriangle size={16} className="mt-0.5 flex-none" /> {r.primaryStaffName} will be notified and the visit goes back to Confirmed for re-assignment.
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------- cancel
const CANCEL_REASONS = ['Patient cancelled', 'Patient unreachable', 'Admitted to hospital', 'Duplicate request', 'No staff available', 'Other']
function CancelDialog({ r, onClose }: { r: ReqLite; onClose: () => void }) {
  const { run, busy } = useAction()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const text = [reason, note.trim()].filter(Boolean).join(' · ')
  return (
    <Drawer
      open
      onClose={onClose}
      title="Cancel request"
      sub={`${r.requestNo} · ${r.patientName}`}
      footer={
        <Foot onClose={onClose}>
          <button
            className={btnClass('rf')}
            disabled={busy || text.length < 2 || (reason === 'Other' && !note.trim())}
            onClick={async () => {
              const ok = await run(() => api(`/requests/${r.id}/cancel`, { body: { reason: text } }), 'Request cancelled')
              if (ok) onClose()
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />} Cancel request
          </button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <span className="hc-label">
            Reason <span className="text-[#DC2626]">*</span>
          </span>
          <ChipPicker options={CANCEL_REASONS} value={reason ? [reason] : []} onChange={(v) => setReason(v[0] ?? '')} max={1} />
        </div>
        <F label="Note">
          <textarea className="hc-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Details for the record" />
        </F>
        <div className="text-[12.5px] text-slate-500">The care team, driver and patient are notified. This cannot be undone.</div>
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------- close visit / invoice (mirrors S7)
function CloseDialog({ r, perms, onClose }: { r: ReqLite; perms: Perms; onClose: () => void }) {
  const { run, busy } = useAction()
  const b = r.billing
  const [f, setF] = useState({ invoiceNo: b.invoiceNo ?? '', invoiceAmount: b.invoiceAmount?.toString() ?? b.billAmount?.toString() ?? '', printed: b.invoicePrinted ?? true })
  const pending = r.pettyCash.filter((p) => p.status === 'PENDING')
  const amt = f.invoiceAmount === '' ? null : Number(f.invoiceAmount)
  const match = b.billAmount == null || amt == null ? null : Math.round(b.billAmount) === Math.round(amt)
  const valid = f.invoiceNo.trim() && amt != null && !isNaN(amt)
  const payload = { invoiceNo: f.invoiceNo.trim(), invoiceAmount: amt, invoicePrinted: f.printed }
  return (
    <Drawer
      open
      onClose={onClose}
      title={perms.manage ? 'Close visit' : 'Invoice'}
      sub={`${r.requestNo} · ${r.patientName}`}
      footer={
        <>
          {pending.length > 0 && perms.manage && <span className="mr-auto text-[12px] font-semibold text-[#B45309]">Decide petty cash first</span>}
          {perms.invoice && (
            <button
              className={btnClass('o', 'md', pending.length && perms.manage ? '' : 'ml-auto')}
              disabled={busy || !valid}
              onClick={async () => {
                const ok = await run(() => api(`/requests/${r.id}/invoice`, { body: payload }), 'Invoice saved')
                if (ok && !perms.manage) onClose()
              }}
            >
              Save invoice only
            </button>
          )}
          {perms.manage && (
            <button
              className={btnClass('g')}
              disabled={busy || !valid || pending.length > 0}
              onClick={async () => {
                const ok = await run(() => api(`/requests/${r.id}/close`, { body: payload }), 'Visit closed')
                if (ok) onClose()
              }}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Verify report & close
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-slate-200 p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Visit summary</div>
          {(
            [
              ['Team', r.summary.team],
              ['Time', r.summary.time],
              ['Tests', r.summary.tests],
              ['Transport', r.summary.transport],
              ['Report', r.summary.report],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex gap-3 py-1 text-[13px]">
              <div className="w-[84px] flex-none text-slate-500">{k}</div>
              <div className="flex-1">{v || '—'}</div>
            </div>
          ))}
        </div>
        <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Billing reconciliation</div>
        <div className="-mt-2 flex flex-col gap-3.5 rounded-card border border-slate-200 p-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-slate-500">Bill collected by staff</span>
            <b>{b.billAmount != null ? [taka(b.billAmount), b.status === 'PAID' ? 'Paid' : b.status === 'DUE' ? 'Due' : b.status, b.method ? PAYMENT_METHOD_LABEL[b.method as 'CASH'] : null].filter(Boolean).join(' · ') : 'Not recorded'}</b>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <F label="Invoice number" req>
              <input className="hc-input" value={f.invoiceNo} placeholder="INV-…" onChange={(e) => setF((x) => ({ ...x, invoiceNo: e.target.value }))} />
            </F>
            <F label="Invoice total (৳)" req>
              <input type="number" min={0} className="hc-input" value={f.invoiceAmount} onChange={(e) => setF((x) => ({ ...x, invoiceAmount: e.target.value }))} />
            </F>
          </div>
          <div>
            <span className="hc-label">
              Invoice paper print status <span className="text-[#DC2626]">*</span>
            </span>
            <Segmented
              items={[
                { value: 'y', label: 'Printed' },
                { value: 'n', label: 'Not printed' },
              ]}
              value={f.printed ? 'y' : 'n'}
              onChange={(v) => setF((x) => ({ ...x, printed: v === 'y' }))}
              h={40}
            />
          </div>
          {match === true && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#15803D]">
              <Check size={14} /> Bill and invoice match
            </div>
          )}
          {match === false && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#B45309]">
              <AlertTriangle size={14} /> Bill {taka(b.billAmount)} vs invoice {taka(amt)} · differs by {taka(Math.abs((b.billAmount ?? 0) - (amt ?? 0)))}
            </div>
          )}
          {match === null && <div className="text-[12.5px] text-slate-500">No bill amount was recorded at check-out.</div>}
        </div>
        {r.pettyCash.length > 0 && (
          <>
            <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Petty cash</div>
            <div className="-mt-2 flex flex-col gap-2">
              {r.pettyCash.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-card border border-slate-200 p-3">
                  <Avatar initials={p.byInitials} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold">
                      {taka(p.amount)} · {p.purpose}
                    </div>
                    <div className="text-[12px] text-slate-500">
                      {p.by}
                      {p.at ? ` · ${p.at}` : ''}
                    </div>
                  </div>
                  {p.status === 'PENDING' && perms.decide ? (
                    <>
                      <ActionButton path={`/requests/${r.id}/petty-cash-decide`} body={{ pettyCashId: p.id, approve: false }} kind="o" size="sm" success="Petty cash rejected">
                        Reject
                      </ActionButton>
                      <ActionButton path={`/requests/${r.id}/petty-cash-decide`} body={{ pettyCashId: p.id, approve: true }} kind="p" size="sm" success="Petty cash approved">
                        Approve
                      </ActionButton>
                    </>
                  ) : (
                    <PettyTag status={p.status} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}

export function PettyTag({ status }: { status: string }) {
  const tone = status === 'APPROVED' ? 'bg-[#DCFCE7] text-[#15803D]' : status === 'REJECTED' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#B45309]'
  return <span className={cx('inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-bold', tone)}>{status}</span>
}

// ---------------------------------------------------------------- email
const PATIENT_TEMPLATES = [
  { key: 'patient_confirmed', label: 'Visit confirmed' },
  { key: 'patient_assigned', label: 'Care team assigned' },
  { key: 'patient_rescheduled', label: 'Visit rescheduled' },
  { key: 'patient_cancelled', label: 'Visit cancelled' },
  { key: 'patient_completed', label: 'Visit completed · thank you' },
]

function defaultTemplate(r: ReqLite) {
  if (r.status === 'CANCELLED') return 'patient_cancelled'
  if (r.status === 'COMPLETED' || r.status === 'CLOSED') return 'patient_completed'
  if (['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'].includes(r.status)) return 'patient_assigned'
  if (r.rescheduled) return 'patient_rescheduled'
  return 'patient_confirmed'
}

function EmailDialog({ r, onClose }: { r: ReqLite; onClose: () => void }) {
  const { run, busy } = useAction()
  const [templateKey, setT] = useState(defaultTemplate(r))
  const [to, setTo] = useState(r.patientEmail ?? '')
  return (
    <Drawer
      open
      onClose={onClose}
      title="Send email"
      sub={`${r.requestNo} · ${r.patientName}`}
      footer={
        <Foot onClose={onClose} note="Logged in Messages">
          <button
            className={btnClass('p')}
            disabled={busy || !to.includes('@')}
            onClick={async () => {
              const ok = await run(
                () => api<{ configured: boolean }>('/messages/email', { body: { requestId: r.id, templateKey, to: to.trim() || undefined } }),
                (x) => (x.configured ? 'Email queued' : 'Email logged (SMTP not configured)'),
              )
              if (ok) onClose()
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} Send
          </button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        <F label="Template" req>
          <select className="hc-input" value={templateKey} onChange={(e) => setT(e.target.value)}>
            {PATIENT_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} · {t.key}
              </option>
            ))}
          </select>
        </F>
        <F label="To" req>
          <input type="email" className="hc-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="patient@example.com" />
        </F>
        {!r.patientEmail && <div className="text-[12.5px] text-[#B45309]">This patient has no email on file. Enter one to send anyway.</div>}
        <div className="text-[12.5px] text-slate-500">The message is rendered from the template with this request&apos;s details. Clinical notes are never included.</div>
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------- WhatsApp with template picker
function WhatsAppDialog({ r, onClose }: { r: ReqLite; onClose: () => void }) {
  const [key, setKey] = useState(defaultTemplate(r))
  const opts = [...PATIENT_TEMPLATES.map((t) => ({ ...t, to: 'patient' as const })), ...(r.primaryStaffId ? [{ key: 'staff_assigned', label: `Staff · ${r.primaryStaffName}`, to: 'staff' as const }] : [])]
  const sel = opts.find((o) => o.key === key) ?? opts[0]
  return (
    <Drawer open onClose={onClose} title="Send WhatsApp" sub={`${r.requestNo} · opens WhatsApp with the message filled in`} width={480}>
      <div className="flex flex-col gap-2">
        <span className="hc-label">Template</span>
        {opts.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setKey(o.key)}
            className={cx('flex items-center gap-3 rounded-card border-[1.5px] px-3.5 py-3 text-left', o.key === sel.key ? 'border-primary bg-[#F8FCFE]' : 'border-slate-200 hover:bg-slate-50')}
          >
            <div className={cx('size-4 flex-none rounded-full border-2', o.key === sel.key ? 'border-[5px] border-primary' : 'border-slate-300')} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{o.label}</div>
              <div className="text-[12px] text-slate-500">
                {o.key} · to {o.to === 'staff' ? 'staff' : r.patientName}
              </div>
            </div>
          </button>
        ))}
        <WhatsAppButton requestId={r.id} templateKey={sel.key} to={sel.to} staffId={sel.to === 'staff' ? r.primaryStaffId ?? undefined : undefined} kind="g" size="lg" className="mt-3 w-full">
          Open WhatsApp
        </WhatsAppButton>
        <div className="mt-1 text-center text-[12px] text-slate-500">After sending, confirm so it is logged on the record.</div>
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------- edit request fields (optimistic concurrency)
export function EditRequestButton({ r }: { r: ReqLite }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-700 hover:underline">
        <Pencil size={13} /> Edit
      </button>
      {open && <EditDialog r={r} onClose={() => setOpen(false)} />}
    </>
  )
}

function EditDialog({ r, onClose }: { r: ReqLite; onClose: () => void }) {
  const router = useRouter()
  const { toast } = useAction()
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [f, setF] = useState({
    priority: r.priority,
    expectedDurationMin: String(r.expectedDurationMin || 45),
    estimatedFee: r.estimatedFee?.toString() ?? '',
    paymentMethod: r.paymentMethod ?? '',
    transportNeeded: r.transportNeeded,
    complaint: r.complaint,
    instructions: r.instructions,
    remarks: r.remarks,
    tests: r.tests,
  })
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }))
  async function save() {
    setBusy(true)
    try {
      await api(`/requests/${r.id}`, {
        method: 'PATCH',
        body: {
          version: r.version,
          priority: f.priority,
          expectedDurationMin: Number(f.expectedDurationMin) || undefined,
          estimatedFee: f.estimatedFee === '' ? undefined : Number(f.estimatedFee),
          paymentMethod: f.paymentMethod || undefined,
          transportNeeded: f.transportNeeded,
          complaint: f.complaint,
          instructions: f.instructions,
          remarks: f.remarks,
          tests: f.tests,
        },
      })
      toast('Request updated', 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      if (e?.code === 'VERSION_CONFLICT') setConflict(true)
      else toast(e?.message ?? 'Could not save', 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title="Edit request"
      sub={`${r.requestNo} · version ${r.version}`}
      footer={
        <Foot onClose={onClose}>
          <button className={btnClass('p')} disabled={busy || conflict} onClick={save}>
            {busy && <Loader2 size={16} className="animate-spin" />} Save changes
          </button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-4">
        {conflict && (
          <div className="rounded-card border border-[#FCD34D] bg-[#FFFBEB] p-3.5">
            <div className="flex items-center gap-2 text-[14px] font-bold text-[#92400E]">
              <AlertTriangle size={16} /> Someone else changed this request
            </div>
            <div className="mt-1 text-[13px] text-[#92400E]">Your edits were not saved. Reload to see the latest version, then make your change again.</div>
            <button
              className={btnClass('k', 'sm', 'mt-2.5')}
              onClick={() => {
                router.refresh()
                onClose()
              }}
            >
              <RefreshCw size={14} /> Reload latest
            </button>
          </div>
        )}
        <div>
          <span className="hc-label">Priority</span>
          <Segmented
            items={[
              { value: 'ROUTINE', label: 'Routine' },
              { value: 'URGENT', label: 'Urgent' },
              { value: 'EMERGENCY', label: 'Emergency' },
            ]}
            value={f.priority}
            onChange={(v) => set('priority', v)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <F label="Duration (min)">
            <input type="number" min={5} step={5} className="hc-input" value={f.expectedDurationMin} onChange={(e) => set('expectedDurationMin', e.target.value)} />
          </F>
          <F label="Estimated fee (৳)">
            <input type="number" min={0} className="hc-input" value={f.estimatedFee} onChange={(e) => set('estimatedFee', e.target.value)} />
          </F>
          <F label="Payment method">
            <select className="hc-input" value={f.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </F>
        </div>
        <F label="Chief complaint">
          <textarea className="hc-input" rows={2} value={f.complaint} onChange={(e) => set('complaint', e.target.value)} />
        </F>
        <F label="Instructions to staff">
          <textarea className="hc-input" rows={2} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} />
        </F>
        <F label="Internal remarks">
          <textarea className="hc-input" rows={2} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </F>
        <div>
          <span className="hc-label">Tests / procedures</span>
          <div className="max-h-[220px] overflow-y-auto rounded-lg border border-slate-200 p-2.5">
            <ChipPicker options={[...TESTS_PROCEDURES]} value={f.tests} onChange={(v) => set('tests', v)} />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="text-[13px] font-semibold">Transport needed</div>
          <Toggle on={f.transportNeeded} onChange={(v) => set('transportNeeded', v)} label="Transport needed" />
        </div>
      </div>
    </Drawer>
  )
}
