'use client'
import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Loader2, Plus, Save, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

export type BookingCfg = {
  enabled: boolean
  from: string
  to: string
  slotMin: number
  bufferMin: number
  capacity: number
  leadMin: number
  daysAhead: number
  closedWeekdays: number[]
  closedDates: string[]
  blocked: string[]
  holdNew: boolean
}
type SlotState = 'open' | 'full' | 'past' | 'blocked' | 'closed'
type Day = { date: string; weekday: number; closed: boolean; slots: { start: string; end: string; label: string; booked: number; capacity: number; state: SlotState }[] }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
/** same rule as lib/booking.ts daySlots — preview while editing */
function preview(c: BookingCfg) {
  const out: string[] = []
  const len = Math.max(15, Number(c.slotMin) || 60)
  const step = len + Math.max(0, Number(c.bufferMin) || 0)
  for (let t = toMin(c.from); t + len <= toMin(c.to) && out.length < 48; t += step) out.push(`${hhmm(t)}–${hhmm(t + len)}`)
  return out
}
const save = (value: Partial<BookingCfg>) => api('/settings', { method: 'PATCH', body: { key: 'booking', value } })

// ==================================================================== rules
export function BookingSettings({ initial }: { initial: BookingCfg }) {
  const router = useRouter()
  const toast = useToast()
  const [c, setC] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [holiday, setHoliday] = useState('')
  const set = <K extends keyof BookingCfg>(k: K, v: BookingCfg[K]) => setC((x) => ({ ...x, [k]: v }))
  const slots = useMemo(() => preview(c), [c])
  const dirty = JSON.stringify(c) !== JSON.stringify(initial)

  async function submit() {
    if (toMin(c.to) <= toMin(c.from)) return toast('Closing time must be after opening time', 'err')
    if (!slots.length) return toast('These hours are shorter than one slot', 'err')
    setBusy(true)
    try {
      const { blocked: _, ...rules } = c // blocked slots are managed on the board
      await save(rules)
      toast('Online booking saved — the public page uses it now', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-bold">Booking rules</h2>
          <p className="text-[13px] text-slate-500">Slots patients can pick on the public page</p>
        </div>
        <a href="/" target="_blank" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-700 hover:underline">
          Public page <ExternalLink size={13} />
        </a>
      </div>

      <Row label="Online booking" hint={c.enabled ? 'Patients choose from the slots below' : 'Off: patients pick from the simple visit slots in General settings'}>
        <Toggle on={c.enabled} onChange={(v) => set('enabled', v)} label="Online booking" />
      </Row>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <L label="Opens">
          <input type="time" className="hc-input" value={c.from} onChange={(e) => set('from', e.target.value)} />
        </L>
        <L label="Closes">
          <input type="time" className="hc-input" value={c.to} onChange={(e) => set('to', e.target.value)} />
        </L>
        <L label="Slot length" hint="Time booked for each visit">
          <Sel value={c.slotMin} onChange={(v) => set('slotMin', v)} options={[30, 45, 60, 90, 120, 180]} unit="min" />
        </L>
        <L label="Buffer after each slot" hint="Travel / gap before the next one">
          <Sel value={c.bufferMin} onChange={(v) => set('bufferMin', v)} options={[0, 10, 15, 20, 30, 45, 60]} unit="min" />
        </L>
        <L label="Visits per slot" hint="Teams that can go out at once">
          <input type="number" min={1} max={20} className="hc-input" value={c.capacity} onChange={(e) => set('capacity', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
        </L>
        <L label="Minimum notice" hint="Hide slots starting sooner">
          <Sel value={c.leadMin} onChange={(v) => set('leadMin', v)} options={[0, 30, 60, 120, 180, 240, 360, 720, 1440]} unit="min" fmt={(m) => (m === 0 ? 'None' : m < 60 ? `${m} min` : `${m / 60} h`)} />
        </L>
        <L label="Book up to">
          <Sel value={c.daysAhead} onChange={(v) => set('daysAhead', v)} options={[3, 7, 14, 21, 30, 60]} unit="days" fmt={(d) => `${d} days ahead`} />
        </L>
      </div>

      <div className="mt-4">
        <span className="hc-label">Closed every week</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d, i) => {
            const on = c.closedWeekdays.includes(i)
            return (
              <button key={d} type="button" onClick={() => set('closedWeekdays', on ? c.closedWeekdays.filter((x) => x !== i) : [...c.closedWeekdays, i])} className={cx('h-9 min-w-12 rounded-lg border px-2.5 text-[13px] font-semibold', on ? 'border-[#FCA5A5] bg-[#FEE2E2] text-[#B91C1C]' : 'border-slate-300 text-slate-700')}>
                {d}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4">
        <span className="hc-label">Holidays / closed dates</span>
        <div className="flex gap-2">
          <input type="date" className="hc-input" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
          <button type="button" disabled={!holiday} onClick={() => (set('closedDates', [...new Set([...c.closedDates, holiday])].sort()), setHoliday(''))} className={btnClass('o', 'md', 'flex-none')}>
            <Plus size={15} /> Add
          </button>
        </div>
        {c.closedDates.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.closedDates.map((d) => (
              <span key={d} className="inline-flex h-8 items-center gap-1 rounded-full bg-slate-100 pl-3 pr-1 text-[12.5px] font-semibold text-slate-700">
                {new Date(`${d}T12:00:00+06:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                <button type="button" onClick={() => set('closedDates', c.closedDates.filter((x) => x !== d))} className="flex size-6 items-center justify-center rounded-full hover:bg-slate-200" aria-label="Remove">
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Row className="mt-4" label="New requests hold their slot" hint={c.holdNew ? 'A slot fills as soon as a patient requests it' : 'A slot fills only when a visit is confirmed'}>
        <Toggle on={c.holdNew} onChange={(v) => set('holdNew', v)} label="New requests hold their slot" />
      </Row>

      <div className="mt-4 rounded-[10px] bg-slate-50 p-3">
        <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-slate-500">Each open day · {slots.length} slots</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <span key={s} className="rounded-md bg-white px-2 py-1 font-mono text-[12px] text-slate-700 ring-1 ring-slate-200">
              {s}
            </span>
          ))}
          {!slots.length && <span className="text-[13px] text-[#B91C1C]">No slots fit these hours</span>}
        </div>
      </div>

      <button type="button" onClick={submit} disabled={busy || !dirty} className={btnClass('p', 'md', 'mt-4 w-full')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save booking rules
      </button>
    </section>
  )
}

// ==================================================================== live board
export function BookingBoard({ days, cfg }: { days: Day[]; cfg: BookingCfg }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function toggleSlot(date: string, start: string) {
    const key = `${date} ${start}`
    const blocked = cfg.blocked.includes(key) ? cfg.blocked.filter((k) => k !== key) : [...cfg.blocked, key]
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
    setBusy(key)
    try {
      await save({ blocked: blocked.filter((k) => k.slice(0, 10) >= today) }) // forget past blocks
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function toggleDay(date: string) {
    const closed = cfg.closedDates.includes(date) ? cfg.closedDates.filter((d) => d !== date) : [...cfg.closedDates, date].sort()
    setBusy(date)
    try {
      await save({ closedDates: closed })
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const tone: Record<SlotState, string> = {
    open: 'border-[#86EFAC] bg-[#F0FDF4] text-[#166534] hover:bg-[#DCFCE7]',
    full: 'border-[#FDBA74] bg-[#FFF7ED] text-[#9A3412]',
    blocked: 'border-slate-300 bg-slate-200 text-slate-600 line-through hover:bg-slate-300',
    past: 'border-slate-200 bg-slate-50 text-slate-400',
    closed: 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]/70',
  }
  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-bold">Next {days.length} days</h2>
          <p className="text-[13px] text-slate-500">Live: confirmed visits fill slots automatically. Tap a slot to block or reopen it.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11.5px] font-semibold">
          <Legend c="bg-[#DCFCE7]">Open</Legend>
          <Legend c="bg-[#FFEDD5]">Booked full</Legend>
          <Legend c="bg-slate-300">Blocked</Legend>
          <Legend c="bg-slate-100">Too soon / past</Legend>
        </div>
      </div>
      {!cfg.enabled && <div className="mb-3 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[13px] text-[#92400E]">Online booking is off: the public page shows the simple visit slots instead.</div>}
      <div className="flex flex-col divide-y divide-slate-100">
        {days.map((d) => {
          const free = d.slots.filter((s) => s.state === 'open').length
          const weeklyClosed = cfg.closedWeekdays.includes(d.weekday)
          return (
            <div key={d.date} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <div className="flex w-full items-center gap-2 sm:w-[150px] sm:flex-none sm:flex-col sm:items-start sm:gap-1">
                <div className="text-[14px] font-bold">{new Date(`${d.date}T12:00:00+06:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                <div className={cx('text-[12px] font-semibold', d.closed ? 'text-[#B91C1C]' : free ? 'text-[#15803D]' : 'text-[#B45309]')}>{d.closed ? (weeklyClosed ? 'Closed (weekly)' : 'Closed') : `${free} of ${d.slots.length} free`}</div>
                {!weeklyClosed && (
                  <button type="button" onClick={() => toggleDay(d.date)} disabled={busy === d.date} className="ml-auto text-[12px] font-semibold text-primary-700 hover:underline sm:ml-0">
                    {busy === d.date ? 'Saving…' : d.closed ? 'Reopen day' : 'Close day'}
                  </button>
                )}
              </div>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {d.slots.map((s) => {
                  const key = `${d.date} ${s.start}`
                  const clickable = s.state === 'open' || s.state === 'blocked'
                  return (
                    <button
                      key={s.start}
                      type="button"
                      disabled={!clickable || busy === key}
                      onClick={() => toggleSlot(d.date, s.start)}
                      title={s.state === 'open' ? 'Click to block this slot' : s.state === 'blocked' ? 'Click to reopen' : s.state === 'full' ? 'All places booked by confirmed visits' : undefined}
                      className={cx('flex h-11 min-w-[96px] flex-col items-center justify-center rounded-lg border px-2 text-[12.5px] font-semibold leading-tight', tone[s.state], !clickable && 'cursor-default')}
                    >
                      {busy === key ? <Loader2 size={14} className="animate-spin" /> : s.label}
                      <span className="text-[10.5px] font-medium no-underline opacity-80">
                        {s.booked}/{s.capacity} booked
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ==================================================================== bits
function Row({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{label}</div>
        {hint && <div className="text-[12.5px] text-slate-500">{hint}</div>}
      </div>
      {children}
    </div>
  )
}
function L({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="hc-label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11.5px] text-slate-500">{hint}</span>}
    </label>
  )
}
function Sel({ value, onChange, options, unit, fmt }: { value: number; onChange: (v: number) => void; options: number[]; unit: string; fmt?: (v: number) => string }) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b)
  return (
    <select className="hc-input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {all.map((o) => (
        <option key={o} value={o}>
          {fmt ? fmt(o) : `${o} ${unit}`}
        </option>
      ))}
    </select>
  )
}
const Legend = ({ c, children }: { c: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 text-slate-600">
    <span className={cx('size-2.5 rounded-sm', c)} /> {children}
  </span>
)
