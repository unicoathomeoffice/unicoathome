'use client'
// Day strip + live slot grid for staff forms — the public booking form's "When" step (BookingForm.tsx) in English.
// Differences for staff: full / past slots stay pickable (amber, with a double-book warning); closed days and
// hand-blocked slots stay locked; any later date can be opened from the calendar and its grid is loaded on demand.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react'
import { api } from '@/components/client/api'
import { cx } from '@/lib/format'
import type { BookingDay } from '@/components/public/BookingForm'

type SlotState = BookingDay['slots'][number]['state']
export type SlotBooking = { enabled: boolean; days: BookingDay[] }

const noon = (iso: string) => new Date(`${iso}T12:00:00+06:00`)
const fmtDay = (iso: string, o: Intl.DateTimeFormatOptions) => noon(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', ...o })
const addDays = (iso: string, n: number) => new Date(noon(iso).getTime() + n * 86400_000).toISOString().slice(0, 10)
export const fmtTime = (hm: string) => new Date(`2000-01-01T${hm}:00+06:00`).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
/** "09:00–10:00" → "9:00 AM – 10:00 AM"; legacy "09–11" → "9:00 AM – 11:00 AM" */
export function slotLabel(s: string) {
  const [a, b] = s.split(/[–-]/).map((h) => h.trim())
  const hm = (x: string) => (x.includes(':') ? x : `${x.padStart(2, '0')}:00`)
  return a && b && /^\d/.test(a) && /^\d/.test(b) ? `${fmtTime(hm(a))} – ${fmtTime(hm(b))}` : s
}
/** First day with an open slot (or the first day) — the form's default date */
export const firstOpen = (days: BookingDay[], fallback: string) => days.find((d) => d.slots.some((s) => s.state === 'open'))?.date ?? days[0]?.date ?? fallback

export function SlotPicker({
  booking,
  legacySlots,
  today,
  date,
  slot,
  onDate,
  onSlot,
  showSlots = true,
  error,
}: {
  booking: SlotBooking
  legacySlots: string[]
  today: string
  date: string
  slot: string
  onDate: (date: string) => void
  onSlot: (slot: string) => void
  /** false in "Exact time" mode: day strip only */
  showSlots?: boolean
  error?: string
}) {
  const [days, setDays] = useState<BookingDay[]>(booking.days)
  const [loadingDay, setLoadingDay] = useState(false)
  const dateInput = useRef<HTMLInputElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const tried = useRef(new Set<string>()) // dates already fetched on demand (never refetch in a loop)

  // ---- live availability: every 2 min and when the tab comes back; keeps days loaded from the calendar
  const refresh = useCallback(async () => {
    if (!booking.enabled) return
    try {
      const r = await api<{ days: BookingDay[] }>('/public/availability')
      setDays((cur) => [...r.days, ...cur.filter((d) => !r.days.some((x) => x.date === d.date) && d.date >= today)].sort((a, b) => a.date.localeCompare(b.date)))
    } catch {}
  }, [booking.enabled, today])
  useEffect(() => {
    if (!booking.enabled) return
    const id = setInterval(refresh, 120_000)
    const onVis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVis)
    return () => (clearInterval(id), document.removeEventListener('visibilitychange', onVis))
  }, [booking.enabled, refresh])

  // A date outside the loaded window (calendar or restored draft): fetch that day's grid
  useEffect(() => {
    if (!booking.enabled || !date || date < today || days.some((d) => d.date === date) || tried.current.has(date)) return
    tried.current.add(date)
    setLoadingDay(true)
    api<{ days: BookingDay[] }>(`/public/availability?from=${date}&days=1`)
      .then((r) => setDays((cur) => [...cur.filter((d) => d.date !== date), ...r.days].sort((x, y) => x.date.localeCompare(y.date))))
      .catch(() => {})
      .finally(() => setLoadingDay(false))
  }, [booking.enabled, date, today, days])

  // keep the chosen day in view
  useEffect(() => {
    strip.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [date])

  const plainDays = Array.from({ length: 14 }, (_, i) => addDays(today, i))
  const dayList = booking.enabled
    ? days.map((d) => ({ date: d.date, open: d.slots.some((s) => s.state === 'open'), closed: d.closed }))
    : [...new Set([...plainDays, ...(date && date >= today ? [date] : [])])].sort().map((d) => ({ date: d, open: true, closed: false }))
  const tomorrow = addDays(today, 1)
  const selected = days.find((d) => d.date === date)
  const slotList: { value: string; label: string; state: SlotState; booked?: number; capacity?: number }[] = booking.enabled
    ? (selected?.slots ?? []).map((s) => ({ value: s.label, label: `${fmtTime(s.start)} – ${fmtTime(s.end)}`, state: s.state, booked: s.booked, capacity: s.capacity }))
    : legacySlots.map((s) => ({ value: s, label: slotLabel(s), state: 'open' as SlotState }))
  const chosen = slotList.find((s) => s.value === slot)
  const stateText = (s: (typeof slotList)[number]) =>
    s.state === 'full' ? `Booked ${s.booked}/${s.capacity}` : s.state === 'past' ? 'Past' : s.state === 'blocked' ? 'Blocked' : s.state === 'closed' ? 'Closed' : 'Available'
  const pickDay = (d: string) => {
    onDate(d)
    onSlot('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div ref={strip} className="-mx-1 flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto px-1 pb-1 no-scrollbar" role="radiogroup" aria-label="Date of service">
          {dayList.map((d) => {
            const on = date === d.date
            const top = d.date === today ? 'Today' : d.date === tomorrow ? 'Tomorrow' : fmtDay(d.date, { weekday: 'short' })
            const off = !d.open
            return (
              <button
                key={d.date}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickDay(d.date)}
                className={cx(
                  'flex h-[58px] w-[74px] flex-none snap-start flex-col items-center justify-center rounded-xl border-[1.5px] text-[11.5px] leading-tight transition',
                  on ? 'border-primary bg-primary text-white shadow-[0_6px_14px_rgba(0,144,202,.3)]' : off ? 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
                )}
              >
                <span className="font-semibold">{top}</span>
                <span className={cx('mt-0.5 text-[13px] font-bold', on ? 'text-white' : off ? 'text-slate-400' : 'text-navy')}>{fmtDay(d.date, { day: 'numeric', month: 'short' })}</span>
                {off && <span className={cx('text-[10px] font-semibold', on ? 'text-white/80' : 'text-[#B45309]')}>{d.closed ? 'Closed' : 'Full'}</span>}
              </button>
            )
          })}
        </div>
        {/* calendar: any later date (staff may book beyond the online window) */}
        <button type="button" onClick={() => dateInput.current?.showPicker?.()} className="relative flex h-[58px] w-12 flex-none items-center justify-center rounded-xl border-[1.5px] border-slate-200 bg-white text-primary hover:border-slate-300" aria-label="Pick a date">
          <CalendarDays size={20} />
          <input
            ref={dateInput}
            type="date"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            min={today}
            value={date}
            onChange={(e) => e.target.value && e.target.value >= today && pickDay(e.target.value)}
          />
        </button>
      </div>
      {error && <div className="text-[12px] font-semibold text-[#B91C1C]">{error}</div>}

      {showSlots && (
        <>
          {loadingDay && !selected ? (
            <div className="flex h-[56px] items-center justify-center gap-2 text-[13px] text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading slots for {fmtDay(date, { day: 'numeric', month: 'short' })}…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Time slot">
              {slotList.map((s) => {
                const on = slot === s.value
                const open = s.state === 'open'
                const locked = s.state === 'closed' || s.state === 'blocked'
                return (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={locked}
                    onClick={() => onSlot(on ? '' : s.value)}
                    className={cx(
                      'flex h-[56px] flex-col items-center justify-center rounded-xl border-[1.5px] text-[13.5px] font-semibold leading-tight transition',
                      on && open && 'border-primary bg-primary-50 text-primary-700 shadow-[0_0_0_3px_rgba(0,144,202,.12)]',
                      on && !open && 'border-[#F59E0B] bg-[#FFFBEB] text-[#B45309] shadow-[0_0_0_3px_rgba(245,158,11,.15)]',
                      !on && open && 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                      !on && !open && !locked && 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300',
                      locked && 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400',
                    )}
                  >
                    <span className={cx(!open && !on && 'line-through decoration-slate-300')}>{s.label}</span>
                    <span className={cx('mt-0.5 text-[11px] font-semibold', open ? (on ? 'text-primary-700' : 'text-[#16A34A]') : on ? 'text-[#B45309]' : 'text-slate-400')}>{stateText(s)}</span>
                  </button>
                )
              })}
              {!slotList.length && <div className="col-span-full text-[13px] text-slate-500">No slots are set up for this day.</div>}
            </div>
          )}
          {chosen && chosen.state === 'full' && (
            <div className="flex items-start gap-2 rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]">
              <AlertTriangle size={16} className="mt-px flex-none" /> This slot is full ({chosen.booked}/{chosen.capacity} booked) — saving will double-book.
            </div>
          )}
          {chosen && chosen.state === 'past' && (
            <div className="flex items-start gap-2 rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]">
              <AlertTriangle size={16} className="mt-px flex-none" /> This time has passed or is inside the minimum notice.
            </div>
          )}
          {booking.enabled && selected && !selected.slots.some((s) => s.state === 'open') && !chosen && (
            <div className="rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]">{selected.closed ? 'Closed for online booking on this day.' : 'No open slots on this day — pick another day, or choose a full slot to double-book.'}</div>
          )}
        </>
      )}
    </div>
  )
}
