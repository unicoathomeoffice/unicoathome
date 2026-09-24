'use client'
// M09 Vitals: 2-column VitalsGrid with units and normal-range hints, live abnormal flags, pain score, flag coordinator.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Flag, Loader2 } from 'lucide-react'
import { stamp, useToast } from '@/components/client'
import { VITALS } from '@/lib/constants'
import { cx, time } from '@/lib/format'
import { sendOrQueue } from './live'
import { BottomBar, CHeader, TimerPill, Body, bigBtn } from './bar'

type Vals = Record<string, string>
const def = (k: string) => VITALS.find((v) => v.key === k)!
const out = (k: string, raw: string) => {
  if (raw === '' || raw == null || k === 'weightKg') return false
  const n = Number(raw)
  if (isNaN(n)) return false
  const d = def(k)
  return n < d.min || n > d.max
}
const range = (k: string) => {
  const d = def(k)
  if (k === 'spo2') return `Normal ≥ ${d.min}`
  return `Normal ${d.min}–${d.max}`
}

export function VitalsForm({
  id,
  initial,
  editable,
  patient,
  recordedAt,
  checkInAt,
  lastWeight,
  vitalsKey,
  flagged,
}: {
  id: string
  initial: Record<string, number | null | undefined>
  editable: boolean
  patient: string
  recordedAt?: string
  checkInAt?: string
  lastWeight?: number | null
  vitalsKey?: string | null
  flagged?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<Vals>(() => Object.fromEntries(VITALS.map((d) => [d.key, initial[d.key] != null ? String(initial[d.key]) : ''])))
  const [flag, setFlag] = useState(!!flagged)
  const [busy, setBusy] = useState(false)
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 6) }))
  const abnormal = useMemo(() => VITALS.filter((d) => out(d.key, v[d.key])).map((d) => d.label), [v])
  const any = VITALS.some((d) => v[d.key] !== '')

  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { flag }
      for (const d of VITALS) body[d.key] = v[d.key] === '' ? null : Number(v[d.key])
      const r = await sendOrQueue(`/requests/${id}/vitals`, body, { label: 'Vitals' })
      // tick the checklist's vitals item with the same time
      if (vitalsKey) await sendOrQueue(`/requests/${id}/checklist/${encodeURIComponent(vitalsKey)}`, { done: true, ...stamp() }, { method: 'PATCH', label: 'Tick · Vitals' }).catch(() => {})
      toast(r.queued ? 'Vitals saved offline · will sync' : abnormal.length || flag ? 'Vitals saved · coordinator notified' : `Vitals saved · ${time(new Date())}`, 'ok')
      router.push(`/m/visits/${id}/checklist`)
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
      setBusy(false)
    }
  }

  const Tile = ({ k, label, unit, hint, children, bad }: { k: string; label: string; unit: string; hint: string; children: React.ReactNode; bad: boolean }) => (
    <label key={k} className={cx('block rounded-card bg-white px-3.5 py-3 shadow-card', bad && 'outline outline-[1.5px] outline-[#DC2626]')}>
      <div className="flex items-center justify-between text-[12px] font-semibold text-slate-500">
        {label}
        {bad && <Flag size={14} className="text-[#DC2626]" />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        {children}
        <span className="flex-none text-[12px] text-slate-500">{unit}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>
    </label>
  )
  const w = (x: string) => ({ width: `${Math.max(x.length, 1) + 0.4}ch` })
  const inputCls = (bad: boolean) => cx('min-w-0 max-w-full bg-transparent text-[26px] font-bold leading-8 outline-none placeholder:text-slate-300', bad ? 'text-[#B91C1C]' : 'text-slate-900')
  const one = (k: string, ph = '—') => (
    <input inputMode="decimal" disabled={!editable} value={v[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} style={w(v[k])} className={inputCls(out(k, v[k]))} aria-label={def(k).label} />
  )
  const bpBad = out('bpSys', v.bpSys) || out('bpDia', v.bpDia)

  return (
    <div className="min-w-0">
      <CHeader back={`/m/visits/${id}`} title="Vitals" sub={`${patient} · ${recordedAt ? `recorded ${time(recordedAt)}` : 'not recorded yet'}`} right={<TimerPill from={checkInAt} />} />
      <Body className="gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          {/* BP spans the two stored values */}
          <label className={cx('block rounded-card bg-white px-3.5 py-3 shadow-card', bpBad && 'outline outline-[1.5px] outline-[#DC2626]')}>
            <div className="flex items-center justify-between text-[12px] font-semibold text-slate-500">
              Blood pressure
              {bpBad && <Flag size={14} className="text-[#DC2626]" />}
            </div>
            <div className="mt-1 flex items-baseline gap-0.5">
              <input inputMode="numeric" disabled={!editable} value={v.bpSys} onChange={(e) => set('bpSys', e.target.value)} placeholder="—" aria-label="BP systolic" style={w(v.bpSys)} className={inputCls(out('bpSys', v.bpSys))} />
              <span className="text-[26px] font-bold text-slate-400">/</span>
              <input inputMode="numeric" disabled={!editable} value={v.bpDia} onChange={(e) => set('bpDia', e.target.value)} placeholder="—" aria-label="BP diastolic" style={w(v.bpDia)} className={inputCls(out('bpDia', v.bpDia))} />
              <span className="flex-none text-[12px] text-slate-500">mmHg</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              Normal {def('bpSys').min}–{def('bpSys').max} / {def('bpDia').min}–{def('bpDia').max}
            </div>
          </label>
          {Tile({ k: 'pulse', label: 'Pulse', unit: 'bpm', hint: range('pulse'), bad: out('pulse', v.pulse), children: one('pulse') })}
          {Tile({ k: 'tempC', label: 'Temperature', unit: '°C', hint: range('tempC'), bad: out('tempC', v.tempC), children: one('tempC') })}
          {Tile({ k: 'spo2', label: 'SpO₂', unit: '%', hint: range('spo2'), bad: out('spo2', v.spo2), children: one('spo2') })}
          {Tile({ k: 'rbs', label: 'RBS', unit: 'mmol/L', hint: range('rbs'), bad: out('rbs', v.rbs), children: one('rbs') })}
          {Tile({ k: 'weightKg', label: 'Weight', unit: 'kg', hint: lastWeight != null ? `Last visit ${lastWeight}` : 'Optional', bad: false, children: one('weightKg') })}
        </div>
        <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
          <div className="flex justify-between text-[12px] font-semibold text-slate-500">
            <span>Pain score</span>
            {out('painScore', v.painScore) && <Flag size={14} className="text-[#DC2626]" />}
          </div>
          <div className="mt-2.5 flex gap-1">
            {Array.from({ length: 11 }, (_, n) => {
              const on = v.painScore !== '' && Number(v.painScore) === n
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!editable}
                  onClick={() => setV((o) => ({ ...o, painScore: on ? '' : String(n) }))}
                  className={cx('flex h-10 flex-1 items-center justify-center rounded-md text-[13px] font-bold', on ? (n > def('painScore').max ? 'bg-[#DC2626] text-white' : 'bg-primary text-white') : 'bg-slate-100 text-slate-500')}
                >
                  {n}
                </button>
              )
            })}
          </div>
        </div>
        {abnormal.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-card bg-[#FEE2E2] px-3.5 py-3 text-[13px] leading-[18px] text-[#B91C1C]">
            <AlertTriangle size={16} className="mt-px flex-none" />
            <div>
              {abnormal.length} value{abnormal.length === 1 ? '' : 's'} outside range ({abnormal.join(', ')}). Saving will notify the coordinator automatically; add a note if already known.
            </div>
          </div>
        )}
        {flag && !abnormal.length && (
          <div className="flex items-start gap-2.5 rounded-card bg-[#FEF3C7] px-3.5 py-3 text-[13px] leading-[18px] text-[#B45309]">
            <Flag size={16} className="mt-px flex-none" />
            <div>The coordinator and doctor on duty will be alerted when you save.</div>
          </div>
        )}
        {!editable && <div className="text-center text-[12px] text-slate-500">Vitals can be recorded by the care team while the visit is in progress.</div>}
      </Body>
      {editable && (
        <BottomBar>
          <button type="button" onClick={() => setFlag((f) => !f)} className={cx(bigBtn('o'), 'flex-1', flag && '!border-[#F59E0B] !bg-[#FEF3C7] !text-[#B45309]')} aria-pressed={flag}>
            <Flag size={18} /> {flag ? 'Flagged' : 'Flag coordinator'}
          </button>
          <button type="button" disabled={busy || !any} onClick={save} className={bigBtn('p', 'flex-[1.4]')}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            Save vitals
          </button>
        </BottomBar>
      )}
    </div>
  )
}
