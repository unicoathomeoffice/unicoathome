'use client'
// Schedule controls: Pause · Resume · Stop · Skip a date · Change the days / end / time.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarX2, Loader2, Pause, Pencil, Play, Square } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { isoDay } from '@/lib/format'
import type { SchedEnd, SchedPattern } from '@/lib/schedule-dates'
import { RepeatPicker, repeatToInput, type Repeat } from './RepeatPicker'

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export function ScheduleActions({ id, status, canManage, pattern, end, time, dates }: { id: string; status: string; canManage: boolean; pattern: SchedPattern; end: SchedEnd; time: string; dates: string[] }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [skip, setSkip] = useState(dates[0] ?? '')
  const [t, setT] = useState(time)
  const [rep, setRep] = useState<Repeat>({
    kind: pattern.kind,
    days: pattern.daysOfWeek ?? [],
    every: String(pattern.everyDays ?? 2),
    endKind: end.kind,
    count: String(end.count ?? 10),
    until: end.until ?? '',
  })

  async function act(body: Record<string, unknown>, ok: string, method: 'POST' | 'PATCH' = 'POST') {
    setBusy(String(body.action ?? 'edit'))
    try {
      const r = await api<{ cancelled?: number; made?: number }>(`/schedules/${id}`, { method, body })
      toast(`${ok}${r.cancelled ? ` · ${r.cancelled} visit${r.cancelled === 1 ? '' : 's'} cancelled` : ''}${r.made ? ` · ${r.made} visit${r.made === 1 ? '' : 's'} made` : ''}`, 'ok')
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  if (!canManage) return <aside className="rounded-2xl bg-white p-4 text-[13px] text-slate-500 shadow-card ring-1 ring-slate-200/70">Only coordinators change schedules.</aside>
  const ended = status === 'ENDED'
  return (
    <aside className="flex flex-col gap-3 self-start rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70">
      <div className="text-[15px] font-bold">Manage</div>
      {!ended && (
        <div className="grid grid-cols-2 gap-2">
          {status === 'ACTIVE' ? (
            <button type="button" disabled={!!busy} className={btnClass('o', 'sm')} onClick={() => confirm('Pause this schedule? Coming visits that have not started are cancelled.') && act({ action: 'pause' }, 'Paused')}>
              {busy === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pause
            </button>
          ) : (
            <button type="button" disabled={!!busy} className={btnClass('p', 'sm')} onClick={() => act({ action: 'resume' }, 'Resumed')}>
              {busy === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Resume
            </button>
          )}
          <button type="button" disabled={!!busy} className={btnClass('o', 'sm', 'text-[#B91C1C]')} onClick={() => confirm('Stop this schedule for good? Coming visits that have not started are cancelled.') && act({ action: 'stop' }, 'Stopped')}>
            {busy === 'stop' ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />} Stop
          </button>
        </div>
      )}
      {!ended && dates.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-3">
          <span className="hc-label">Skip one date</span>
          <div className="flex gap-2">
            <select className="hc-input min-w-0 flex-1" value={skip} onChange={(e) => setSkip(e.target.value)}>
              {dates.filter((d) => d >= isoDay()).map((d) => (
                <option key={d} value={d}>
                  {day(d)}
                </option>
              ))}
            </select>
            <button type="button" disabled={!!busy || !skip} className={btnClass('o', 'md', 'flex-none')} onClick={() => act({ action: 'skip', date: skip }, `Skipped ${day(skip)}`)}>
              {busy === 'skip' ? <Loader2 size={14} className="animate-spin" /> : <CalendarX2 size={14} />} Skip
            </button>
          </div>
        </div>
      )}
      {!ended &&
        (editing ? (
          <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3">
            <RepeatPicker value={rep} onChange={setRep} start={isoDay()} time={t} />
            <label>
              <span className="hc-label">Time</span>
              <input type="time" className="hc-input" value={t} onChange={(e) => setT(e.target.value)} />
            </label>
            <div className="text-[12px] text-slate-500">Coming visits that have not started are replaced by ones that follow the new rule.</div>
            <div className="flex gap-2">
              <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!!busy}
                className={btnClass('p', 'sm', 'ml-auto')}
                onClick={() => {
                  const ready = repeatToInput(rep)
                  if (typeof ready === 'string') return toast(ready, 'err')
                  act({ ...ready, time: t }, 'Schedule changed', 'PATCH')
                }}
              >
                {busy === 'edit' && <Loader2 size={14} className="animate-spin" />} Save changes
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditing(true)}>
            <Pencil size={14} /> Change days, end or time
          </button>
        ))}
      {ended && <div className="text-[13px] text-slate-500">This schedule has ended. Use “Book again” on a visit to start a new one.</div>}
    </aside>
  )
}
