// Formatting helpers. Safe for both server and client components. All times shown in Asia/Dhaka.
import { TZ } from './constants'

type D = Date | string | number | null | undefined
const d = (v: D) => (v == null || v === '' ? null : new Date(v))

const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o })
const fTime = f({ hour: '2-digit', minute: '2-digit', hour12: false })
const fDay = f({ weekday: 'short', day: 'numeric', month: 'short' })
const fDate = f({ day: 'numeric', month: 'short', year: 'numeric' })
const fDayNum = f({ day: 'numeric', month: 'short' })
const fIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 14:32 */
export const time = (v: D) => (d(v) ? fTime.format(d(v)!) : '—')
/** Fri 26 Sep */
export const day = (v: D) => (d(v) ? fDay.format(d(v)!).replace(',', '') : '—')
/** 26 Sep 2026 */
export const date = (v: D) => (d(v) ? fDate.format(d(v)!) : '—')
/** 26 Sep */
export const dayNum = (v: D) => (d(v) ? fDayNum.format(d(v)!) : '—')
/** Fri 26 Sep · 14:32 */
export const dateTime = (v: D) => (d(v) ? `${day(v)} · ${time(v)}` : '—')
/** 2026-09-26 in Dhaka */
export const isoDay = (v: D = new Date()) => (d(v) ? fIso.format(d(v)!) : '')

/** "Today", "Tomorrow", "Yesterday" or "Fri 26 Sep" */
export function relDay(v: D) {
  const x = d(v)
  if (!x) return '—'
  const k = isoDay(x)
  const now = Date.now()
  if (k === isoDay(now)) return 'Today'
  if (k === isoDay(now + 86400_000)) return 'Tomorrow'
  if (k === isoDay(now - 86400_000)) return 'Yesterday'
  return day(x)
}

/** "just now", "5 min ago", "2 h ago", or date */
export function ago(v: D) {
  const x = d(v)
  if (!x) return '—'
  const m = Math.round((Date.now() - x.getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`
  return dayNum(x)
}

export function minutesBetween(a: D, b: D) {
  const x = d(a),
    y = d(b)
  if (!x || !y) return null
  return Math.round((y.getTime() - x.getTime()) / 60000)
}

/** 43 min · 1 h 12 min */
export function dur(min: number | null | undefined) {
  if (min == null || isNaN(min)) return '—'
  const m = Math.abs(Math.round(min))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** mm:ss countdown text */
export function mmss(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** ৳ 3,500 */
export const taka = (n: number | null | undefined) => (n == null ? '—' : `৳ ${Math.round(n).toLocaleString('en-IN')}`)

/** +880 1711-234567 */
export function phone(p?: string | null) {
  if (!p) return '—'
  const digits = p.replace(/\D/g, '')
  const local = digits.startsWith('880') ? digits.slice(3) : digits.replace(/^0/, '')
  if (local.length === 10) return `+880 ${local.slice(0, 4)}-${local.slice(4)}`
  return p
}

export const ageGender = (age?: number | null, g?: string | null) => [age != null ? `${age}` : '', g ?? ''].filter(Boolean).join(' ')

export function initialsOf(name?: string | null) {
  if (!name) return '?'
  const parts = name.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Build a Date from a Dhaka-local "YYYY-MM-DD" and "HH:mm". */
export function dhakaDate(ymd: string, hm = '09:00') {
  return new Date(`${ymd}T${hm.length === 5 ? hm : '09:00'}:00+06:00`)
}

/** Start and end of a Dhaka day as UTC Dates */
export function dayRange(ymd = isoDay()) {
  const start = new Date(`${ymd}T00:00:00+06:00`)
  return { start, end: new Date(start.getTime() + 86400_000) }
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
