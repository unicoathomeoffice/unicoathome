'use client'
// Request page → "Act for the team" (override access): accept for the staff, mark the next visit step for them, complete
// the visit in one go, and put a car + any active driver on the trip directly (e.g. when the supervisor says so verbally).
// Every action asks first and is audited "on behalf".
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Car, CheckCircle2, Loader2, MapPin, Navigation, ShieldAlert, UserCheck } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

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
}

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
  const showCar = p.canCar && p.transport.needed && (!p.transport.mode || p.transport.mode === 'UNICO_CAR') && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(p.status)
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
            <Car size={14} /> {p.transport.vehicleId ? 'Change car & driver' : 'Car & driver'}
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

function CarDriver({ requestId, requestNo, transport, cars, drivers, onClose }: Props & { onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const first = cars.find((c) => c.id === transport.vehicleId) ?? cars.find((c) => c.status !== 'IN_SERVICE') ?? cars[0]
  const [car, setCar] = useState(first?.id ?? '')
  const [driver, setDriver] = useState(transport.driverId ?? first?.driverId ?? '')
  const [pickup, setPickup] = useState(transport.pickup)
  const [ret, setRet] = useState(transport.ret)
  const [busy, setBusy] = useState(false)
  const chosen = cars.find((c) => c.id === car)
  const drv = drivers.find((d) => d.id === driver)
  async function go() {
    if (!chosen || !drv) return toast('Pick a car and a driver', 'err')
    if (!confirm(`Send ${chosen.name} (${chosen.plate}) with ${drv.name} for ${requestNo}?\n\nPick-up ${pickup || '—'} · return ${ret || '—'}.\nThe requisition (with the car) and the gate pass go to the security supervisor and the driver.`)) return
    setBusy(true)
    try {
      await api(`/requests/${requestId}/transport`, { body: { mode: 'UNICO_CAR', vehicleId: car, driverId: driver, pickupTime: pickup || undefined, returnTime: ret || undefined } })
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
      sub={`${requestNo} · pick any car and any active driver`}
      width={480}
      footer={
        <div className="flex w-full justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass('p')} disabled={busy || !chosen || !drv} onClick={go}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Car size={16} />} Assign car & driver
          </button>
        </div>
      }
    >
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
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">The vehicle requisition is updated with the car (Section B) and the gate pass is made — both go to the on-call security supervisor, the gate pass also to the driver.</div>
      </div>
    </Drawer>
  )
}
