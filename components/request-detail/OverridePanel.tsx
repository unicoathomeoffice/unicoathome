'use client'
// Request page → "Act for the team" (override access): accept for the staff, mark the next visit step for them, complete
// the visit in one go, and put a car + any active driver on the trip directly (e.g. when the supervisor says so verbally).
// Every action asks first and is audited "on behalf".
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Car, CheckCircle2, Loader2, MapPin, Navigation, ShieldAlert, UserCheck } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { NotifyPicker } from '@/components/client/NotifyPicker'
import { btnClass } from '@/components/ui'
import { cx, taka } from '@/lib/format'

export type CarLite = { id: string; name: string; plate: string; driverId?: string; status?: string }
export type DriverLite = { id: string; name: string; phone?: string }

type Props = {
  requestId: string
  requestNo: string
  status: string
  staffName: string | null
  canOverride: boolean
  /** may put a car + driver on the trip (car supervisor or override) */
  canCar: boolean
  transport: { needed: boolean; mode?: string | null; vehicleId?: string | null; driverId?: string | null; pickup: string; ret: string }
  cars: CarLite[]
  drivers: DriverLite[]
  openChecklist: number
  /** "Car not available": team members who can get the petty cash, the patient's area, the usual amount, last given */
  team?: { id: string; name: string }[]
  area?: string
  defaultAmount?: number
  cashGiven?: { amount: number; mode?: string } | null
}

const OWN_MODES = [
  ['UBER', 'Uber'],
  ['PATHAO', 'Pathao'],
  ['CNG', 'CNG'],
  ['RICKSHAW', 'Rickshaw'],
  ['OTHER', 'Other'],
] as const
const MODE_LABEL: Record<string, string> = Object.fromEntries(OWN_MODES)

const STEP: Record<string, { action: string; label: string; icon: typeof UserCheck } | undefined> = {
  ASSIGNED: { action: 'accept', label: 'Accept for', icon: UserCheck },
  ACCEPTED: { action: 'en-route', label: 'Mark on the way for', icon: Navigation },
  EN_ROUTE: { action: 'check-in', label: 'Check in for', icon: MapPin },
}

export function OverridePanel(p: Props) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [dlg, setDlg] = useState<null | 'complete' | 'car'>(null)
  const step = STEP[p.status]
  const who = p.staffName ?? 'the team'
  const active = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'].includes(p.status)
  // car & driver, or (no car free) own transport + petty cash — both from the same drawer
  const showCar = p.canCar && p.transport.needed && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(p.status)
  const own = !!p.transport.mode && p.transport.mode !== 'UNICO_CAR'
  if (!(p.canOverride && active) && !showCar) return null

  async function doStep() {
    if (!step) return
    if (!confirm(`${step.label} ${who}?\n\nThis is recorded as done by you on their behalf.`)) return
    setBusy(step.action)
    try {
      await api(`/requests/${p.requestId}/${step.action}`, { body: {} })
      toast(`${p.requestNo} · ${step.label.toLowerCase()} ${who}`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#FFFBEB] px-3.5 py-2.5 ring-1 ring-[#FDE68A]">
      <ShieldAlert size={16} className="flex-none text-[#B45309]" />
      <span className="text-[13px] font-semibold text-[#92400E]">{p.canOverride && active ? `Act for ${who}` : 'Transport'}</span>
      <span className="hidden text-[12px] text-[#92400E]/80 sm:inline">{p.canOverride && active ? '· override, recorded as done on their behalf' : '· put a car and driver on this trip'}</span>
      <div className="ml-auto flex flex-wrap gap-2">
        {p.canOverride && step && (
          <button type="button" disabled={!!busy} onClick={doStep} className={btnClass('o', 'sm', 'bg-white')}>
            {busy === step.action ? <Loader2 size={14} className="animate-spin" /> : <step.icon size={14} />} {step.label} {who.split(' ').slice(0, 2).join(' ')}
          </button>
        )}
        {p.canOverride && active && (
          <button type="button" disabled={!!busy} onClick={() => setDlg('complete')} className={btnClass('o', 'sm', 'bg-white')}>
            <CheckCircle2 size={14} /> Complete visit now
          </button>
        )}
        {showCar && (
          <button type="button" disabled={!!busy} onClick={() => setDlg('car')} className={btnClass('o', 'sm', 'bg-white')}>
            <Car size={14} /> {own ? `Transport · ${MODE_LABEL[p.transport.mode!] ?? 'own'}${p.cashGiven ? ` · ${taka(p.cashGiven.amount)} given` : ''}` : p.transport.vehicleId ? 'Change car & driver' : 'Car & driver'}
          </button>
        )}
      </div>
      {dlg === 'complete' && <CompleteNow {...p} who={who} onClose={() => setDlg(null)} />}
      {dlg === 'car' && <CarDriver {...p} onClose={() => setDlg(null)} />}
    </div>
  )
}

function CompleteNow({ requestId, requestNo, status, who, openChecklist, onClose }: Props & { who: string; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState({ start: '', end: '', note: '' })
  const [busy, setBusy] = useState(false)
  const steps = [
    status === 'ASSIGNED' && `accept the visit for ${who}`,
    ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE'].includes(status) && `check in at ${v.start || 'now'}`,
    openChecklist > 0 && `tick ${openChecklist} open mandatory checklist item${openChecklist === 1 ? '' : 's'} as “entered by coordinator”`,
    `check out at ${v.end || 'now'} and complete — the patient gets the completion message and the report is ready`,
  ].filter(Boolean) as string[]
  async function go() {
    if (!confirm(`Complete ${requestNo} for ${who}?\n\n• ${steps.join('\n• ')}`)) return
    setBusy(true)
    try {
      await api(`/requests/${requestId}/complete-now`, { body: { start: v.start || undefined, end: v.end || undefined, note: v.note.trim() || undefined } })
      toast(`${requestNo} completed for ${who}`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title="Complete visit now"
      sub={`${requestNo} · for ${who} — when the visit was done without the app`}
      width={480}
      footer={
        <div className="flex w-full justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass('p')} disabled={busy} onClick={go}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Complete visit
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="hc-label">Visit started</span>
            <input type="time" className="hc-input" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
            <span className="mt-1 block text-[12px] text-slate-500">Empty = {status === 'IN_PROGRESS' ? 'the check-in time' : 'now'}</span>
          </label>
          <label>
            <span className="hc-label">Visit ended</span>
            <input type="time" className="hc-input" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
            <span className="mt-1 block text-[12px] text-slate-500">Empty = now</span>
          </label>
        </div>
        <label>
          <span className="hc-label">Note (optional)</span>
          <input className="hc-input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="e.g. Staff phone off — confirmed by phone call" />
        </label>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
          <b className="text-slate-800">This will:</b>
          <ul className="mt-1 list-disc pl-5">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <div className="mt-1.5 text-[12px]">Recorded in the audit as done by you on their behalf.</div>
        </div>
      </div>
    </Drawer>
  )
}

function CarDriver({ requestId, requestNo, transport, cars, drivers, team = [], area, defaultAmount, onClose }: Props & { onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  // "Car not available" → own transport + petty cash (approved at once, voucher on WhatsApp)
  const [kind, setKind] = useState<'car' | 'own'>(transport.mode && transport.mode !== 'UNICO_CAR' ? 'own' : cars.length ? 'car' : 'own')
  const [mode, setMode] = useState<string>(transport.mode && transport.mode !== 'UNICO_CAR' ? transport.mode : 'UBER')
  const [forUser, setForUser] = useState(team[0]?.id ?? '')
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '')
  const [purposeEdited, setPurposeEdited] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const purpose = purposeEdited ?? `Transport · ${MODE_LABEL[mode] ?? mode} to ${area || "the patient's home"} and back`
  async function giveCash() {
    const who = team.find((t) => t.id === forUser)
    const amt = Number(amount)
    if (!who) return toast('Pick who gets the petty cash', 'err')
    if (!(amt > 0)) return toast('Enter the amount', 'err')
    if (!confirm(`No car for ${requestNo}: the team goes by ${MODE_LABEL[mode]}.\n\nGive ${who.name} petty cash ৳${amt.toLocaleString('en-IN')} (approved now)?\nThe voucher goes on WhatsApp to them and the cash counter; Security / Transport are told no car is going.`)) return
    setBusy(true)
    try {
      const r = await api<{ voucherNo: string }>(`/requests/${requestId}/own-transport`, { body: { mode, amount: amt, forUserId: forUser, purpose: purpose.trim(), note: note.trim() || undefined } })
      toast(`Petty cash ৳${amt.toLocaleString('en-IN')} given · voucher ${r.voucherNo} on its way`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  const first = cars.find((c) => c.id === transport.vehicleId) ?? cars.find((c) => c.status !== 'IN_SERVICE') ?? cars[0]
  const [car, setCar] = useState(first?.id ?? '')
  const [driver, setDriver] = useState(transport.driverId ?? first?.driverId ?? '')
  const [pickup, setPickup] = useState(transport.pickup)
  const [ret, setRet] = useState(transport.ret)
  const [busy, setBusy] = useState(false)
  const [notify, setNotify] = useState<string[] | null>(null)
  const chosen = cars.find((c) => c.id === car)
  const drv = drivers.find((d) => d.id === driver)
  async function go() {
    if (!chosen || !drv) return toast('Pick a car and a driver', 'err')
    if (!confirm(`Send ${chosen.name} (${chosen.plate}) with ${drv.name} for ${requestNo}?\n\nPick-up ${pickup || '—'} · return ${ret || '—'}.\nWhatsApp goes only to the people ticked under "Notify on WhatsApp".`)) return
    setBusy(true)
    try {
      await api(`/requests/${requestId}/transport`, { body: { mode: 'UNICO_CAR', vehicleId: car, driverId: driver, pickupTime: pickup || undefined, returnTime: ret || undefined, notify: notify ?? undefined } })
      toast(`${chosen.name} · ${drv.name} assigned — gate pass on its way`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title="Car & driver"
      sub={kind === 'car' ? `${requestNo} · pick any car and any active driver` : `${requestNo} · no car free: own transport + petty cash`}
      width={480}
      footer={
        <div className="flex w-full justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          {kind === 'car' ? (
            <button type="button" className={btnClass('p')} disabled={busy || !chosen || !drv} onClick={go}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Car size={16} />} Assign car & driver
            </button>
          ) : (
            <button type="button" className={btnClass('g')} disabled={busy || !forUser || !(Number(amount) > 0)} onClick={giveCash}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Give petty cash & send voucher
            </button>
          )}
        </div>
      }
    >
      <div className="mb-4 flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
        {(
          [
            ['car', 'Unico car'],
            ['own', 'Car not available'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cx('flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold', kind === k ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}>
            {k === 'car' ? <Car size={15} /> : <Banknote size={15} />} {l}
          </button>
        ))}
      </div>
      {kind === 'own' ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <span className="hc-label">The team goes by</span>
            <div className="flex flex-wrap gap-2">
              {OWN_MODES.map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={cx('h-9 rounded-full px-4 text-[13.5px] font-semibold ring-1', mode === k ? 'bg-primary text-white ring-primary' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <label>
              <span className="hc-label">Petty cash for</span>
              <select className="hc-input" value={forUser} onChange={(e) => setForUser(e.target.value)}>
                {!team.length && <option value="">Assign the team first</option>}
                {team.map((t, i) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {i === 0 ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="hc-label">Amount (৳)</span>
              <input className="hc-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="600" />
            </label>
          </div>
          <label>
            <span className="hc-label">Purpose</span>
            <input className="hc-input" value={purpose} onChange={(e) => setPurposeEdited(e.target.value)} />
          </label>
          <label>
            <span className="hc-label">Note (optional)</span>
            <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. car in workshop" />
          </label>
          <div className="rounded-lg bg-[#F0FDF4] px-3 py-2.5 text-[12.5px] text-[#166534]">
            Approved at once (it won’t hold up closing the request). A petty cash voucher PDF is made — sent on WhatsApp to the staff member and the cash counter (Settings → Fleet & drivers) — and the Security / Transport groups are told no hospital car is going.
          </div>
        </div>
      ) : (
      <div className="flex flex-col gap-3.5">
        <div>
          <span className="hc-label">Car</span>
          <div className="overflow-hidden rounded-card border border-slate-200">
            {cars.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCar(c.id)
                  if (c.driverId && drivers.some((d) => d.id === c.driverId)) setDriver(c.driverId)
                }}
                className={cx('flex w-full items-center gap-3 px-3.5 py-2.5 text-left', i > 0 && 'border-t border-slate-100', c.id === car ? 'bg-primary-50' : 'hover:bg-slate-50')}
              >
                <span className={cx('flex size-[18px] flex-none items-center justify-center rounded-full border-2', c.id === car ? 'border-primary' : 'border-slate-300')}>{c.id === car && <span className="size-2 rounded-full bg-primary" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-[14px] font-semibold">{c.name}</span> <span className="text-[12.5px] text-slate-500">· {c.plate}</span>
                  <span className="block text-[12px] text-slate-500">
                    {c.driverId ? `Usual driver ${drivers.find((d) => d.id === c.driverId)?.name ?? '—'}` : 'No usual driver'}
                    {c.status === 'IN_SERVICE' && <span className="text-[#B45309]"> · in service</span>}
                  </span>
                </span>
              </button>
            ))}
            {!cars.length && <div className="px-3.5 py-3 text-[13px] text-slate-500">No cars yet — add them in Settings → Fleet & drivers.</div>}
          </div>
        </div>
        <label>
          <span className="hc-label">Driver (any active driver)</span>
          <select className="hc-input" value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">Pick a driver…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.phone ? ` · ${d.phone}` : ''}
                {cars.find((c) => c.driverId === d.id) ? ` · usual car ${cars.find((c) => c.driverId === d.id)!.name}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="hc-label">Pick-up at hospital</span>
            <input type="time" className="hc-input" value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </label>
          <label>
            <span className="hc-label">Return</span>
            <input type="time" className="hc-input" value={ret} onChange={(e) => setRet(e.target.value)} />
          </label>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">The vehicle requisition is updated with the car (Section B) and the gate pass is made. Choose below who gets them on WhatsApp.</div>
        <NotifyPicker params={car ? { events: ['CAR_ALLOTTED'], requestId, vehicleId: car, driverId: driver || undefined } : null} value={notify} onChange={setNotify} />
      </div>
      )}
    </Drawer>
  )
}
