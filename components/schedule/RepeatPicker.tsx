'use client'
// How a visit repeats: Daily · chosen weekdays · every N days, and until: a number of visits · a date · ongoing.
// Shows the next dates live. Used by the New request form ("Repeating") and the request page ("Repeat on a schedule").
import { CalendarClock } from 'lucide-react'
import { describeSchedule, scheduleDates, addDays, type SchedEnd, type SchedPattern } from '@/lib/schedule-dates'

export type Repeat = { kind: SchedPattern['kind']; days: number[]; every: string; endKind: SchedEnd['kind']; count: string; until: string }
export const REPEAT_DEFAULT: Repeat = { kind: 'WEEKDAYS', days: [], every: '2', endKind: 'ONGOING', count: '10', until: '' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** → the API's { pattern, end } (or the reason it isn't complete yet) */
export function repeatToInput(v: Repeat): { pattern: SchedPattern; end: SchedEnd } | string {
  if (v.kind === 'WEEKDAYS' && !v.days.length) return 'Pick the days the visits repeat on'
  const every = Number(v.every)
  if (v.kind === 'EVERY_N' && !(every >= 1)) return 'Every how many days?'
  const count = Number(v.count)
  if (v.endKind === 'COUNT' && !(count >= 1)) return 'How many visits?'
  if (v.endKind === 'UNTIL' && !v.until) return 'Until which date?'
  return {
    pattern: { kind: v.kind, ...(v.kind === 'WEEKDAYS' ? { daysOfWeek: [...v.days].sort() } : {}), ...(v.kind === 'EVERY_N' ? { everyDays: every } : {}) },
    end: { kind: v.endKind, ...(v.endKind === 'COUNT' ? { count } : {}), ...(v.endKind === 'UNTIL' ? { until: v.until } : {}) },
  }
}

const chip = (on: boolean) => `h-9 rounded-full px-3.5 text-[13px] font-semibold transition ${on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:ring-slate-400'}`

export function RepeatPicker({ value: v, onChange, start, time }: { value: Repeat; onChange: (v: Repeat) => void; start: string; time?: string }) {
  const set = (p: Partial<Repeat>) => onChange({ ...v, ...p })
  const ready = repeatToInput(v)
  const preview = typeof ready === 'string' || !start ? [] : scheduleDates({ start, pattern: ready.pattern, end: ready.end }, start, addDays(start, 120)).slice(0, 6)
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="hc-label">Repeats</span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['DAILY', 'Every day'],
              ['WEEKDAYS', 'On chosen days'],
              ['EVERY_N', 'Every few days'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={chip(v.kind === k)} onClick={() => set({ kind: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {v.kind === 'WEEKDAYS' && (
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <button key={d} type="button" onClick={() => set({ days: v.days.includes(i) ? v.days.filter((x) => x !== i) : [...v.days, i] })} className={`size-11 rounded-full text-[13px] font-bold transition ${v.days.includes(i) ? 'bg-primary text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:ring-primary'}`}>
              {d.slice(0, 2)}
            </button>
          ))}
          <button type="button" onClick={() => set({ days: [1, 2, 3, 4, 5, 6] })} className="h-11 rounded-full px-3 text-[12px] font-semibold text-primary-700 hover:bg-primary-50">
            Sat–Thu
          </button>
          <button type="button" onClick={() => set({ days: [0, 2, 4] })} className="h-11 rounded-full px-3 text-[12px] font-semibold text-primary-700 hover:bg-primary-50">
            Sun · Tue · Thu
          </button>
        </div>
      )}
      {v.kind === 'EVERY_N' && (
        <label className="flex items-center gap-2 text-[13.5px]">
          Every
          <input className="hc-input w-20 text-center" inputMode="numeric" value={v.every} onChange={(e) => set({ every: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
          days
        </label>
      )}
      <div>
        <span className="hc-label">Ends</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={chip(v.endKind === 'COUNT')} onClick={() => set({ endKind: 'COUNT' })}>
            After
          </button>
          {v.endKind === 'COUNT' && (
            <span className="flex items-center gap-1.5 text-[13px]">
              <input className="hc-input w-16 text-center" inputMode="numeric" value={v.count} onChange={(e) => set({ count: e.target.value.replace(/\D/g, '').slice(0, 3) })} /> visits
            </span>
          )}
          <button type="button" className={chip(v.endKind === 'UNTIL')} onClick={() => set({ endKind: 'UNTIL' })}>
            On a date
          </button>
          {v.endKind === 'UNTIL' && <input type="date" className="hc-input w-auto" min={start} value={v.until} onChange={(e) => set({ until: e.target.value })} />}
          <button type="button" className={chip(v.endKind === 'ONGOING')} onClick={() => set({ endKind: 'ONGOING' })}>
            Ongoing
          </button>
        </div>
      </div>
      <div className="rounded-lg bg-[#F0F9FF] px-3 py-2.5 text-[12.5px] ring-1 ring-[#BAE6FD]">
        {typeof ready === 'string' ? (
          <span className="text-[#0369A1]">{ready}</span>
        ) : (
          <>
            <div className="flex items-center gap-1.5 font-semibold text-[#0369A1]">
              <CalendarClock size={14} /> {describeSchedule(ready.pattern, ready.end)}
              {time ? ` · ${time}` : ''}
            </div>
            {preview.length > 0 && <div className="mt-1 text-slate-600">Next: {preview.map(fmt).join(', ')}{preview.length === 6 ? '…' : ''}</div>}
            <div className="mt-1 text-[11.5px] text-slate-500">Visits are made 2 weeks ahead, confirmed, and given to the same team once you assign one.</div>
          </>
        )}
      </div>
    </div>
  )
}
