'use client'
// Settings → WhatsApp → Sending safety: live meters (this minute / hour / today, warm-up, queue, quiet-hours hold,
// paused state) and the limits that keep the QR-paired hospital number from looking like a bot.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PlayCircle, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Cfg = { perMinute: number; perHour: number; perDay: number; perRecipientHour: number; perRecipientDay: number; delayMinSec: number; delayMaxSec: number; typing: boolean; checkNumbers: boolean; dedupeMin: number; quietHours: boolean; warmUpDays: number; optOut: boolean }
type Status = { minute: number; hour: number; day: number; cap: number; queued: number; held: number; paused: { until: string; reason?: string } | null; optOuts: number; notOnWa: number; warmDay: number | null }

const RECOMMENDED: Cfg = { perMinute: 6, perHour: 60, perDay: 300, perRecipientHour: 4, perRecipientDay: 12, delayMinSec: 2, delayMaxSec: 6, typing: true, checkNumbers: true, dedupeMin: 10, quietHours: true, warmUpDays: 7, optOut: true }

export function WaSafetyCard({ initial, status }: { initial: Cfg; status: Status }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<Cfg>(initial)
  const [busy, setBusy] = useState<null | 'save' | 'resume'>(null)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const num = (k: keyof Cfg, label: string, min: number, max: number, unit = '') => (
    <label className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="number" min={min} max={max} className="hc-input h-8 w-[76px] px-2 text-right" value={v[k] as number} onChange={(e) => setV({ ...v, [k]: Math.max(min, Math.min(max, Number(e.target.value) || min)) })} />
        {unit && <span className="w-8 text-[12px] text-slate-500">{unit}</span>}
      </span>
    </label>
  )
  const tog = (k: keyof Cfg, label: string, sub: string) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="text-[13.5px]">
        {label}
        <div className="text-[11.5px] text-slate-500">{sub}</div>
      </div>
      <Toggle on={v[k] as boolean} onChange={(x) => setV({ ...v, [k]: x })} label={label} />
    </div>
  )
  const meter = (label: string, n: number, max: number) => (
    <div className="min-w-[110px] flex-1 rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">{label}</div>
      <div className="text-[18px] font-bold">
        {n}
        <span className="text-[13px] font-semibold text-slate-400"> / {max}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className={cx('h-full rounded-full', n >= max ? 'bg-[#DC2626]' : n >= max * 0.8 ? 'bg-[#F59E0B]' : 'bg-[#16A34A]')} style={{ width: `${Math.min(100, (n / Math.max(1, max)) * 100)}%` }} />
      </div>
    </div>
  )

  async function save() {
    if (v.delayMaxSec < v.delayMinSec) return toast('The longest pause must be at least the shortest', 'err')
    setBusy('save')
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'whatsappSafety', value: v } })
      toast('Sending safety saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function resume() {
    if (!confirm('Resume sending now? If WhatsApp is still refusing messages, the number is at risk — waiting is safer.')) return
    setBusy('resume')
    try {
      await api('/settings/whatsapp', { body: { action: 'resume' } })
      toast('Sending resumed', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col rounded-card bg-white p-5 shadow-card">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-[#15803D]" />
        <h2 className="text-base font-bold">WhatsApp sending safety</h2>
      </div>
      <p className="mt-1 text-[13px] text-slate-500">Keeps the hospital number sending like a careful person to lower the risk of a ban. Messages over a limit wait and go out later — nothing is lost.</p>

      {status.paused && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#FEE2E2] px-3 py-2.5 text-[13px] text-[#B91C1C]">
          <b>Paused until {new Date(status.paused.until).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</b>
          {status.paused.reason && <span>· {status.paused.reason}</span>}
          <button type="button" onClick={resume} disabled={!!busy} className={btnClass('o', 'sm', 'ml-auto')}>
            {busy === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Resume now
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {meter('This minute', status.minute, initial.perMinute)}
        {meter('This hour', status.hour, initial.perHour)}
        {meter(status.warmDay ? `Today · warm-up day ${status.warmDay}` : 'Today', status.day, status.cap)}
      </div>
      <div className="mt-2 text-[12px] text-slate-500">
        {status.queued} waiting{status.held ? ` · ${status.held} held for the morning (quiet hours)` : ''} · {status.optOuts} opted out (STOP) · {status.notOnWa} numbers not on WhatsApp
      </div>

      <div className="mt-3 grid gap-x-6 border-t border-slate-100 pt-2 sm:grid-cols-2">
        <div>
          {num('perMinute', 'Max per minute', 1, 20)}
          {num('perHour', 'Max per hour', 5, 300)}
          {num('perDay', 'Max per day', 20, 1500)}
          {num('perRecipientHour', 'Per person per hour', 1, 20)}
          {num('perRecipientDay', 'Per person per day', 1, 60)}
          {num('warmUpDays', 'Warm-up after pairing', 0, 30, 'days')}
        </div>
        <div>
          {num('delayMinSec', 'Shortest pause between messages', 1, 30, 's')}
          {num('delayMaxSec', 'Longest pause', 1, 60, 's')}
          {num('dedupeMin', 'Skip the same text to the same person within', 0, 240, 'min')}
          {tog('typing', 'Show “typing…” before each message', 'Like a person writing it')}
          {tog('checkNumbers', 'Only real WhatsApp numbers', 'Checked once before the first message')}
          {tog('quietHours', 'Hold routine messages at night', 'Quiet hours in Notification rules; urgent ones still go')}
          {tog('optOut', '“Reply STOP” for patients', 'Patients who reply STOP get no more WhatsApp')}
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">The QR-paired number uses WhatsApp Web, which WhatsApp doesn’t officially support for businesses — these rules lower the risk but can’t remove it. For high volume, the official WhatsApp Business Cloud API (Meta) is ban-proof.</div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <button type="button" onClick={save} disabled={!!busy || !dirty} className={btnClass('p', 'md')}>
          {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
        </button>
        <button type="button" onClick={() => setV(RECOMMENDED)} className={btnClass('o', 'md')}>
          <RotateCcw size={16} /> Recommended
        </button>
      </div>
    </section>
  )
}
