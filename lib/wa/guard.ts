import 'server-only'
import { MessageLog, Patient, WaAuth, WaContact } from '../models'
import { getSettings } from '../settings'

// Sending safety for the QR-paired hospital WhatsApp (an unofficial WhatsApp Web session). WhatsApp bans numbers that
// behave like bots, so the sender behaves like a careful person: rate limits that ramp up after pairing, random pauses
// with "typing…", only real WhatsApp numbers, no duplicate texts, routine messages wait out the night, STOP opts out,
// and sending pauses on its own when WhatsApp pushes back. This lowers the risk; only the official WhatsApp Business
// Cloud API is ban-proof.

const PROVIDER = 'wa_baileys'

/** Templates that must not wait (quiet hours) and go first when the queue is limited. */
export const URGENT_KEYS = new Set(['hod_new_request', 'patient_en_route', 'patient_confirmed', 'vehicle_requisition', 'gate_pass', 'staff_assigned', 'test', 'car_requested', 'car_allotted', 'car_changed', 'car_cancelled', 'car_out', 'car_back'])
const LOW_KEYS = new Set(['daily_summary', 'visit_update', 'patient_visit_summary', 'claim_form'])
/** How long a queued message is still worth sending (e.g. after WhatsApp was unlinked for hours). Others never expire. */
const STALE_AFTER_H: Record<string, number> = { patient_en_route: 2, car_out: 3, car_back: 3, staff_assigned: 8, hod_new_request: 12, car_requested: 12, car_allotted: 12, car_changed: 12, daily_summary: 20, visit_update: 24, patient_confirmed: 48 }
export function tooLate(m: { templateKey?: string; at?: Date }) {
  const h = m.templateKey ? STALE_AFTER_H[m.templateKey] : undefined
  return h != null && !!m.at && Date.now() - new Date(m.at).getTime() > h * 3600_000 ? h : null
}

export function priorityOf(templateKey?: string) {
  return templateKey && URGENT_KEYS.has(templateKey) ? 10 : templateKey && LOW_KEYS.has(templateKey) ? -10 : 0
}

const getMeta = async () => (await WaAuth.findById('meta').lean<any>()) ?? {}
const setMeta = (patch: Record<string, unknown>) => WaAuth.updateOne({ _id: 'meta' }, { $set: patch }, { upsert: true })

// ---------------------------------------------------------------- limits + warm-up
export async function safety() {
  return (await getSettings()).whatsappSafety
}

/** Daily cap after pairing ramps from 40 to perDay over warmUpDays (new numbers that blast get banned fastest). */
export function dailyCap(perDay: number, warmUpDays: number, pairedAt?: Date | string | null) {
  if (!pairedAt || !warmUpDays) return perDay
  const day = Math.floor((Date.now() - new Date(pairedAt).getTime()) / 86400_000)
  if (day >= warmUpDays) return perDay
  return Math.round(40 + ((perDay - 40) * day) / warmUpDays)
}

const since = (ms: number) => new Date(Date.now() - ms)
const countSent = (from: Date, to?: string) => MessageLog.countDocuments({ channel: 'WHATSAPP', provider: PROVIDER, sentAt: { $gte: from }, ...(to ? { to } : {}) })

/** How many messages may go out right now (0 = wait). */
export async function allowance() {
  const [cfg, meta] = await Promise.all([safety(), getMeta()])
  const [m, h, d] = await Promise.all([countSent(since(60_000)), countSent(since(3600_000)), countSent(since(86400_000))])
  const cap = dailyCap(cfg.perDay, cfg.warmUpDays, meta.pairedAt)
  return { left: Math.max(0, Math.min(cfg.perMinute - m, cfg.perHour - h, cap - d)), minute: m, hour: h, day: d, cap, cfg, meta }
}

export async function recipientRoom(to: string, cfg: Awaited<ReturnType<typeof safety>>) {
  const [h, d] = await Promise.all([countSent(since(3600_000), to), countSent(since(86400_000), to)])
  return h < cfg.perRecipientHour && d < cfg.perRecipientDay
}

/** Same text to the same number recently (double clicks, retries) → don't send again. */
export async function isDuplicate(m: { _id: unknown; to: string; renderedText?: string; attachmentId?: unknown }, minutes: number) {
  if (!minutes) return false
  return !!(await MessageLog.exists({
    _id: { $ne: m._id },
    channel: 'WHATSAPP',
    provider: PROVIDER,
    to: m.to,
    renderedText: m.renderedText ?? '',
    attachmentId: m.attachmentId ?? null,
    sentAt: { $gte: since(minutes * 60_000) },
  }))
}

// ---------------------------------------------------------------- quiet hours
export async function inQuietHours(now = new Date()) {
  const s = await getSettings()
  if (!s.whatsappSafety.quietHours) return false
  const { from, to } = s.quietHours ?? { from: '22:00', to: '07:00' }
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  return from <= to ? t >= from && t < to : t >= from || t < to
}

// ---------------------------------------------------------------- numbers: on WhatsApp? opted out?
export async function contactState(number: string) {
  return WaContact.findById(number).lean<any>()
}
export async function rememberCheck(number: string, exists: boolean) {
  await WaContact.updateOne({ _id: number }, { $set: { exists, checkedAt: new Date() } }, { upsert: true })
}
export const checkFresh = (c: any) => c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < 30 * 86400_000

/** "STOP" / "বন্ধ" reply → no more WhatsApp to this number (patients' consent switched off too). */
export async function optOut(number: string) {
  await WaContact.updateOne({ _id: number }, { $set: { optOut: true, optOutAt: new Date() } }, { upsert: true })
  const tail = number.slice(-10)
  await Patient.updateMany({ $or: [{ phone: new RegExp(`${tail}$`) }, { whatsapp: new RegExp(`${tail}$`) }] }, { $set: { 'consent.whatsapp': false } })
}
export const STOP_RX = /^\s*(stop|unsubscribe|বন্ধ|বন্ধ করুন)\s*[.!]?\s*$/i

/** First message ever to this number and it's for a patient → add how to stop. */
export async function needsOptOutFooter(to: string, patientId: unknown) {
  if (!patientId || !(await safety()).optOut) return false
  return !(await MessageLog.exists({ channel: 'WHATSAPP', provider: PROVIDER, to, sentAt: { $exists: true } }))
}
export const OPT_OUT_FOOTER = '\n\nReply STOP to stop WhatsApp messages from Unico.'

// ---------------------------------------------------------------- circuit breaker
const PUSHBACK = /rate-overlimit|overlimit|429|not-authorized|forbidden|403|401|blocked|spam/i

/** Pause sending after WhatsApp pushes back: 30 min, then 1 h, 2 h … up to 12 h. */
export async function tripBreaker(reason: string) {
  const meta = await getMeta()
  const level = Math.min((meta.breakerLevel ?? 0) + 1, 6)
  const mins = Math.min(30 * 2 ** (level - 1), 720)
  const until = new Date(Date.now() + mins * 60_000)
  await setMeta({ pausedUntil: until, pauseReason: reason.slice(0, 200), breakerLevel: level, lastError: reason.slice(0, 300), lastErrorAt: new Date() })
  const { notifyRoles } = await import('../messaging')
  await notifyRoles(['SUPER_ADMIN', 'HC_ADMIN'], { type: 'SYSTEM', title: `WhatsApp sending paused for ${mins >= 60 ? `${mins / 60} h` : `${mins} min`}`, body: `To protect the hospital number: ${reason.slice(0, 140)}. Settings → WhatsApp → Resume when it’s safe.`, url: '/settings#whatsapp', priority: 'high' })
  return until
}
export const isPushback = (msg: string) => PUSHBACK.test(msg)
export async function pausedUntil() {
  const meta = await getMeta()
  return meta.pausedUntil && new Date(meta.pausedUntil) > new Date() ? { until: new Date(meta.pausedUntil), reason: meta.pauseReason as string | undefined } : null
}
export async function resume() {
  await setMeta({ pausedUntil: null, pauseReason: null })
}
/** a clean run slowly forgives earlier trips */
export async function calmDown() {
  const meta = await getMeta()
  if (meta.breakerLevel && (!meta.pausedUntil || new Date(meta.pausedUntil) < since(6 * 3600_000))) await setMeta({ breakerLevel: Math.max(0, meta.breakerLevel - 1) })
}

// ---------------------------------------------------------------- pacing
export const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min)
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** roughly the time a person needs to type this (1–4 s) */
export const typingMs = (text?: string) => Math.min(4000, 1000 + (text?.length ?? 0) * 18)

/** For the Settings card. */
export async function safetyStatus() {
  const a = await allowance()
  const [queued, held, paused, optOuts, notOnWa] = await Promise.all([
    MessageLog.countDocuments({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED' }),
    (await inQuietHours()) ? MessageLog.countDocuments({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED', priority: { $lt: 10 }, initiatedBy: null }) : 0,
    pausedUntil(),
    WaContact.countDocuments({ optOut: true }),
    WaContact.countDocuments({ exists: false }),
  ])
  const warmDay = a.meta.pairedAt ? Math.floor((Date.now() - new Date(a.meta.pairedAt).getTime()) / 86400_000) + 1 : null
  return { minute: a.minute, hour: a.hour, day: a.day, cap: a.cap, cfg: a.cfg, queued, held, paused, optOuts, notOnWa, warmDay: warmDay && warmDay <= a.cfg.warmUpDays ? warmDay : null }
}
