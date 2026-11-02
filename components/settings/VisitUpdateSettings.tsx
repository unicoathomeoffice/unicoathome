'use client'
// Settings → Notification rules: who gets the automatic short visit update on WhatsApp (lib/services/updates.ts).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Save, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Cfg = { enabled: boolean; toHods: boolean; toPatient: boolean; extra: { id: string; name: string; phone: string }[] }
const newId = () => Math.random().toString(36).slice(2, 10)

export function VisitUpdateSettings({ initial }: { initial: Cfg }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<Cfg>(initial)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const bad = v.extra.filter((e) => e.name.trim().length < 2 || e.phone.replace(/\D/g, '').length < 10)
  async function save() {
    setBusy(true)
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'visitUpdates', value: { ...v, extra: v.extra.map((e) => ({ ...e, name: e.name.trim(), phone: e.phone.trim() })) } } })
      toast('Visit update settings saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  const row = (k: 'enabled' | 'toHods' | 'toPatient', label: string, sub: string) => (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-2.5 first:border-t-0">
      <div>
        <div className="text-[14px] font-semibold">{label}</div>
        <div className="text-[12px] text-slate-500">{sub}</div>
      </div>
      <Toggle on={v[k]} onChange={(x) => setV({ ...v, [k]: x })} label={label} />
    </div>
  )
  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <h2 className="text-[16px] font-bold">Visit update on WhatsApp</h2>
      <p className="mb-2 text-[13px] text-slate-500">A short summary (times, vitals, checklist, medicines, bill) is generated after each visit and sent when the team is back at the hospital — or at completion when return tracking is off.</p>
      {row('enabled', 'Send automatically', 'Once per visit')}
      <div className={cx(!v.enabled && 'opacity-60')}>
        {row('toHods', 'Heads of department', 'Of the visit’s service (Department heads list above)')}
        {row('toPatient', 'Patient (friendly version)', 'Vitals, medicines, advice and next visit — no internal times')}
        <div className="border-t border-slate-100 pt-2.5">
          <div className="text-[14px] font-semibold">More WhatsApp numbers</div>
          <div className="mb-2 text-[12px] text-slate-500">Managers or anyone else who should get every visit update</div>
          <div className="flex flex-col gap-2">
            {v.extra.map((e) => (
              <div key={e.id} className="grid grid-cols-[1fr_170px_auto] gap-2">
                <input className="hc-input h-9" placeholder="Name" value={e.name} onChange={(x) => setV({ ...v, extra: v.extra.map((y) => (y.id === e.id ? { ...y, name: x.target.value } : y)) })} />
                <input className="hc-input h-9" placeholder="01XXXXXXXXX" inputMode="tel" value={e.phone} onChange={(x) => setV({ ...v, extra: v.extra.map((y) => (y.id === e.id ? { ...y, phone: x.target.value } : y)) })} />
                <button type="button" onClick={() => setV({ ...v, extra: v.extra.filter((y) => y.id !== e.id) })} className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-[#B91C1C]" aria-label="Remove">
                  <X size={16} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setV({ ...v, extra: [...v.extra, { id: newId(), name: '', phone: '' }] })} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-slate-300 px-3 text-[13px] font-semibold text-primary-700 hover:bg-primary-50">
              <Plus size={15} /> Add number
            </button>
          </div>
        </div>
      </div>
      {bad.length > 0 && <div className="mt-2 text-[12.5px] text-[#B91C1C]">Give every number a name and a full mobile number.</div>}
      <button type="button" onClick={save} disabled={busy || !dirty || bad.length > 0} className={btnClass('p', 'md', 'mt-4')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
      </button>
    </section>
  )
}
