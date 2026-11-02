'use client'
// Settings → Notification rules: the daily WhatsApp summary — who gets it, at what time, preview and send now.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Loader2, Plus, Save, Send, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Cfg = { enabled: boolean; time: string; toHods: boolean; toUpdateNumbers: boolean; extra: { id: string; name: string; phone: string }[] }
const newId = () => Math.random().toString(36).slice(2, 10)

export function DailySummarySettings({ initial }: { initial: Cfg }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<Cfg>(initial)
  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'send'>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const bad = v.extra.filter((e) => e.name.trim().length < 2 || e.phone.replace(/\D/g, '').length < 10)

  async function run(kind: 'save' | 'preview' | 'send') {
    setBusy(kind)
    try {
      if (kind === 'save') {
        await api('/settings', { method: 'PATCH', body: { key: 'dailyWhatsApp', value: { ...v, extra: v.extra.map((e) => ({ ...e, name: e.name.trim(), phone: e.phone.trim() })) } } })
        toast('Daily summary settings saved', 'ok')
        router.refresh()
      } else if (kind === 'preview') {
        setPreview((await api<{ text: string }>('/daily-summary')).text)
      } else {
        const r = await api<{ sent: number; skipped?: string }>('/daily-summary', { body: {} })
        toast(r.sent ? `Summary sent to ${r.sent} on WhatsApp` : `Not sent: ${r.skipped ?? 'nobody to send to'}`, r.sent ? 'ok' : 'err')
      }
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const row = (k: 'enabled' | 'toHods' | 'toUpdateNumbers', label: string, sub: string) => (
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
      <h2 className="text-[16px] font-bold">Daily WhatsApp summary</h2>
      <p className="mb-2 text-[13px] text-slate-500">Today’s visits, timings, money and tomorrow’s bookings in one short message. Sent once a day at the first activity in the app after the chosen time — at the latest 8 PM.</p>
      {row('enabled', 'Send every day', 'Once a day')}
      <div className={cx(!v.enabled && 'opacity-60')}>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-2.5">
          <div className="text-[14px] font-semibold">Time</div>
          <input type="time" className="hc-input h-9 w-[120px]" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
        </div>
        {row('toHods', 'All department heads', 'Everyone in the Department heads groups above')}
        {row('toUpdateNumbers', 'Visit update numbers', 'The extra numbers in “Visit update on WhatsApp”')}
        <div className="border-t border-slate-100 pt-2.5">
          <div className="text-[14px] font-semibold">More WhatsApp numbers</div>
          <div className="mt-2 flex flex-col gap-2">
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
      {preview && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3.5 py-3 text-[13px] leading-[20px] ring-1 ring-slate-200">{preview}</div>}
      {bad.length > 0 && <div className="mt-2 text-[12.5px] text-[#B91C1C]">Give every number a name and a full mobile number.</div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => run('save')} disabled={!!busy || !dirty || bad.length > 0} className={btnClass('p', 'md')}>
          {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
        </button>
        <button type="button" onClick={() => run('preview')} disabled={!!busy} className={btnClass('o', 'md')}>
          {busy === 'preview' ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />} Preview today
        </button>
        <button type="button" onClick={() => run('send')} disabled={!!busy || dirty} className={btnClass('o', 'md')} title={dirty ? 'Save first' : undefined}>
          {busy === 'send' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send now
        </button>
      </div>
    </section>
  )
}
