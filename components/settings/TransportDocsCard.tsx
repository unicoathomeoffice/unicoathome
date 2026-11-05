'use client'
// Settings → Fleet & drivers: car paperwork — who gets the Vehicle Requisition Form and gate pass on WhatsApp
// (on-call security supervisors by shift), the dept. head approver, vehicle type and an optional email copy.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Plus, Save, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Sup = { id: string; name: string; phone: string; from: string; to: string; active: boolean }
type Cfg = { sendRequisition: boolean; sendGatePass: boolean; vehicleType: 'Car' | 'Micro' | 'Ambulance'; approverId: string; emailCopy: string; supervisors: Sup[]; pettyCash: { name: string; phone: string; defaultAmount: number } }
const newId = () => Math.random().toString(36).slice(2, 10)

export function TransportDocsCard({ initial, approvers, waPaired, approverSigned }: { initial: Cfg; approvers: { id: string; name: string; sub: string }[]; waPaired: boolean; approverSigned: boolean | null }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<Cfg>(initial)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const bad = v.supervisors.filter((s) => s.name.trim().length < 2 || s.phone.replace(/\D/g, '').length < 10)
  const upd = (id: string, p: Partial<Sup>) => setV({ ...v, supervisors: v.supervisors.map((s) => (s.id === id ? { ...s, ...p } : s)) })

  async function save() {
    setBusy(true)
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'transportDocs', value: { ...v, emailCopy: v.emailCopy.trim(), pettyCash: { name: v.pettyCash.name.trim(), phone: v.pettyCash.phone.trim(), defaultAmount: Math.round(v.pettyCash.defaultAmount || 0) }, supervisors: v.supervisors.map((s) => ({ ...s, name: s.name.trim(), phone: s.phone.trim() })) } } })
      toast('Car requisition settings saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-primary-700" />
        <h2 className="text-base font-bold">Car requisition &amp; gate pass</h2>
      </div>
      <p className="mt-1 text-[13px] text-slate-500">When the care team of a Unico-car visit is assigned, the Vehicle Requisition Form (Annex-3) is filled with the team and sent to the on-call security supervisor on WhatsApp (not when the request is created). When a car is allotted, the completed form and a gate pass follow (the gate pass also goes to the driver).</p>
      {!waPaired && <div className="mt-3 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[13px] text-[#92400E]">WhatsApp is not paired — forms are still made and kept on the request, but not sent.</div>}

      <div className="mt-4 flex flex-col divide-y divide-slate-100">
        {(
          [
            ['sendRequisition', 'Send the requisition once staff are assigned (ticked by default)'],
            ['sendGatePass', 'Send the gate pass when a car is allotted (ticked by default)'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-[14px] font-semibold">{label}</span>
            <Toggle on={v[k]} onChange={(x) => setV({ ...v, [k]: x })} label={label} />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="text-[14px] font-semibold">Security supervisor (on call)</div>
        <div className="mb-2 text-[12px] text-slate-500">Whoever’s shift covers the time of the request gets it; leave the shift empty for always on call. If no shift matches, all active supervisors get it.</div>
        <div className="flex flex-col gap-2">
          {v.supervisors.map((s) => (
            <div key={s.id} className={cx('grid gap-2 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-[1fr_150px_190px_auto]', !s.active && 'opacity-60')}>
              <input className="hc-input h-9" placeholder="Name" value={s.name} onChange={(e) => upd(s.id, { name: e.target.value })} aria-label="Name" />
              <input className="hc-input h-9" placeholder="WhatsApp 01XXXXXXXXX" inputMode="tel" value={s.phone} onChange={(e) => upd(s.id, { phone: e.target.value })} aria-label="WhatsApp number" />
              <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                <input type="time" className="hc-input h-9 px-1.5" value={s.from} onChange={(e) => upd(s.id, { from: e.target.value })} aria-label="Shift from" />–
                <input type="time" className="hc-input h-9 px-1.5" value={s.to} onChange={(e) => upd(s.id, { to: e.target.value })} aria-label="Shift to" />
              </div>
              <div className="flex items-center gap-1.5">
                <Toggle on={s.active} onChange={(x) => upd(s.id, { active: x })} label={`${s.name || 'Supervisor'} active`} />
                <button type="button" onClick={() => setV({ ...v, supervisors: v.supervisors.filter((x) => x.id !== s.id) })} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-[#B91C1C]" aria-label="Remove">
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setV({ ...v, supervisors: [...v.supervisors, { id: newId(), name: '', phone: '', from: '', to: '', active: true }] })} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-slate-300 px-3 text-[13px] font-semibold text-primary-700 hover:bg-primary-50">
            <Plus size={15} /> Add supervisor
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label>
          <span className="hc-label">Dept. head (approver)</span>
          <select className="hc-input" value={v.approverId} onChange={(e) => setV({ ...v, approverId: e.target.value })}>
            <option value="">— none (sign by hand) —</option>
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.sub}
              </option>
            ))}
          </select>
          {v.approverId && approverSigned === false && <span className="mt-1 block text-[12px] text-[#B45309]">Their signature is added only after they upload it and allow it on their Account page.</span>}
        </label>
        <label>
          <span className="hc-label">Type of vehicle</span>
          <select className="hc-input" value={v.vehicleType} onChange={(e) => setV({ ...v, vehicleType: e.target.value as Cfg['vehicleType'] })}>
            <option>Car</option>
            <option>Micro</option>
            <option>Ambulance</option>
          </select>
        </label>
        <label>
          <span className="hc-label">Email copy (optional)</span>
          <input className="hc-input" type="email" value={v.emailCopy} onChange={(e) => setV({ ...v, emailCopy: e.target.value })} placeholder="ruhul.security@unicohospitals.com" />
        </label>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3.5">
        <div className="text-[14px] font-semibold">Petty cash · when no car is free</div>
        <div className="mb-2 text-[12px] text-slate-500">Request page → Car & driver → “Car not available”: the voucher PDF goes on WhatsApp to the staff member and to this cash counter.</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
          <label>
            <span className="hc-label">Cash counter / accounts</span>
            <input className="hc-input" value={v.pettyCash.name} onChange={(e) => setV({ ...v, pettyCash: { ...v.pettyCash, name: e.target.value } })} placeholder="Accounts / cash counter" />
          </label>
          <label>
            <span className="hc-label">Their WhatsApp</span>
            <input className="hc-input" inputMode="tel" value={v.pettyCash.phone} onChange={(e) => setV({ ...v, pettyCash: { ...v.pettyCash, phone: e.target.value } })} placeholder="01XXXXXXXXX" />
          </label>
          <label>
            <span className="hc-label">Usual amount (৳)</span>
            <input className="hc-input" inputMode="numeric" value={String(v.pettyCash.defaultAmount ?? '')} onChange={(e) => setV({ ...v, pettyCash: { ...v.pettyCash, defaultAmount: Number(e.target.value.replace(/\D/g, '') || 0) } })} />
          </label>
        </div>
        {v.pettyCash.phone && v.pettyCash.phone.replace(/\D/g, '').length < 10 && <div className="mt-1 text-[12px] text-[#B91C1C]">Enter a full mobile number.</div>}
      </div>
      {bad.length > 0 && <div className="mt-2 text-[12.5px] text-[#B91C1C]">Give every supervisor a name and a full mobile number.</div>}
      <button type="button" onClick={save} disabled={busy || !dirty || bad.length > 0} className={btnClass('p', 'md', 'mt-4')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
      </button>
    </section>
  )
}
