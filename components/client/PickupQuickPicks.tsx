'use client'
// One-tap pick-up times for the car: "30 min / 45 min / 1 h / 1 h 30 before the visit" and the times used recently.
import { cx } from '@/lib/format'

const OFFSETS: [number, string][] = [
  [30, '30 min'],
  [45, '45 min'],
  [60, '1 h'],
  [90, '1 h 30'],
]
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const toHHMM = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** "08:20" → "8:20 AM" */
export const ampm = (hhmm: string) => {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function PickupQuickPicks({ visitTime, recent = [], value, onChange }: { visitTime?: string; recent?: string[]; value: string; onChange: (hhmm: string) => void }) {
  const before = visitTime && /^\d{2}:\d{2}$/.test(visitTime) ? OFFSETS.map(([m, label]) => ({ t: toHHMM(toMin(visitTime) - m), label: `${label} before` })) : []
  const recents = recent.filter((t) => !before.some((b) => b.t === t)).slice(0, 4)
  if (!before.length && !recents.length) return null
  const chip = (t: string, label: string) => (
    <button
      key={label + t}
      type="button"
      onClick={() => onChange(t)}
      className={cx('flex h-8 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold transition', value === t ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400')}
    >
      {ampm(t)} <span className="font-medium text-slate-400">{label}</span>
    </button>
  )
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {before.length > 0 && <div className="flex flex-wrap gap-1.5">{before.map((b) => chip(b.t, `· ${b.label}`))}</div>}
      {recents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent</span>
          {recents.map((t) => chip(t, ''))}
        </div>
      )}
    </div>
  )
}
