'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'

export type MapsCfg = { useGoogle: boolean; monthlyFree: number; reservePct: number; dailyCap: 'auto' | number }

/** Settings → Maps & API usage: the switches that keep Google Maps inside the free tier. */
export function MapsSettings({ initial, suggested }: { initial: MapsCfg; suggested: number }) {
  const router = useRouter()
  const toast = useToast()
  const [c, setC] = useState(initial)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(c) !== JSON.stringify(initial)
  const auto = c.dailyCap === 'auto'

  async function save() {
    setBusy(true)
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'maps', value: c } })
      toast('Maps settings saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <h2 className="text-[16px] font-bold">Cost control</h2>
      <p className="mb-4 text-[13px] text-slate-500">Google is used only while the budget lasts; after that the public page switches to free OpenStreetMap by itself. Nothing ever stops working.</p>

      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Use Google Maps when available</div>
          <div className="text-[12.5px] text-slate-500">{c.useGoogle ? 'Google address search and pin map when the key, billing and budget allow' : 'Off: everything runs on OpenStreetMap (free, no key needed)'}</div>
        </div>
        <Toggle on={c.useGoogle} onChange={(v) => setC({ ...c, useGoogle: v })} label="Use Google Maps" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="hc-label">Free calls per month</span>
          <input type="number" min={100} step={100} className="hc-input" value={c.monthlyFree} onChange={(e) => setC({ ...c, monthlyFree: Math.max(100, Number(e.target.value) || 0) })} />
          <span className="mt-0.5 block text-[11.5px] text-slate-500">Google’s free tier: 10,000 per API</span>
        </label>
        <label className="block">
          <span className="hc-label">Safety margin</span>
          <select className="hc-input" value={c.reservePct} onChange={(e) => setC({ ...c, reservePct: Number(e.target.value) })}>
            {[0, 5, 10, 15, 20, 30].map((p) => (
              <option key={p} value={p}>
                {p}% kept unused
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11.5px] text-slate-500">Never spend the last {c.reservePct}%</span>
        </label>
      </div>

      <div className="mt-4">
        <span className="hc-label">Daily cap</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setC({ ...c, dailyCap: 'auto' })} className={`h-10 flex-1 rounded-lg border-[1.5px] text-[13.5px] font-semibold ${auto ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-300 text-slate-700'}`}>
            Automatic · {suggested}/day
          </button>
          <div className={`flex h-10 flex-1 items-center rounded-lg border-[1.5px] px-2 ${auto ? 'border-slate-300' : 'border-primary bg-primary-50'}`}>
            <input type="number" min={1} className="h-full w-full bg-transparent text-[13.5px] font-semibold outline-none" placeholder="Custom" value={auto ? '' : c.dailyCap} onChange={(e) => setC({ ...c, dailyCap: Math.max(1, Number(e.target.value) || 1) })} />
            <span className="text-[12px] text-slate-500">/day</span>
          </div>
        </div>
        <p className="mt-1.5 text-[12.5px] text-slate-500">Automatic spreads the monthly allowance evenly, so one busy day can’t use up the rest of the month. When a day’s cap is reached, Google pauses until tomorrow and OpenStreetMap takes over.</p>
      </div>

      <button type="button" onClick={save} disabled={busy || !dirty} className={btnClass('p', 'md', 'mt-4 w-full')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
      </button>
    </section>
  )
}
