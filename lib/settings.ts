import 'server-only'
import { cache } from 'react'
import { Setting } from './models'
import { SLOTS } from './constants'
import { forget, memo } from './memo'

export const HOD_CATEGORIES = ['Doctor', 'Nursing', 'Lab', 'Physio'] as const
/** groupId: which alert group; services: optional ServiceType codes this person is limited to.
 *  category: first-version field (contacts keyed by category) — read as group `cat-<category>`. */
export type HodContact = { id: string; groupId?: string; category?: (typeof HOD_CATEGORIES)[number]; name: string; designation: string; phone: string; services?: string[]; active: boolean }
/** category: built-in group following a ServiceType category; services: codes, or 'ALL'; message: own WhatsApp text */
export type HodGroup = { id: string; name: string; category?: string; services: 'ALL' | string[]; message?: string; active: boolean }

/** Non-secret configuration editable from Settings (W15 / A5). Secrets stay in env vars. */
export const DEFAULT_SETTINGS = {
  general: {
    hospitalName: 'Unico Hospitals PLC',
    department: 'Family Medicine · Home Care',
    hospitalPhone: process.env.HOSPITAL_PHONE ?? '+880 1841-996655',
    address: 'Plot 1, Road 12, Dhaka',
    workingHours: { from: '08:00', to: '20:00' },
    /** pin of the hospital: return-trip tracking ends when staff come within radiusM of it */
    hospitalLocation: { lat: null as number | null, lng: null as number | null, radiusM: 150 },
    slots: [...SLOTS] as string[],
  },
  /** Public online booking (home page): slot grid, capacity and closures — managed in Settings → Online booking */
  booking: {
    enabled: true,
    from: '09:00',
    to: '17:00',
    slotMin: 60, // visit slot length
    bufferMin: 0, // travel / gap after each slot
    capacity: 1, // visits that can run in the same slot (teams)
    leadMin: 120, // minimum notice before a slot starts
    daysAhead: 14,
    closedWeekdays: [] as number[], // 0 = Sunday … 6 = Saturday
    closedDates: [] as string[], // YYYY-MM-DD holidays
    blocked: [] as string[], // 'YYYY-MM-DD HH:MM' slots blocked by hand
    holdNew: false, // unconfirmed (new) requests also occupy their slot
  },
  /** Google Maps cost control (free tier). Public pages fall back to OpenStreetMap when a cap is reached. */
  maps: {
    useGoogle: true, // when false, everything runs on free OpenStreetMap even if a key exists
    monthlyFree: 10000, // Google's free calls per month (per API)
    reservePct: 10, // keep this share of the monthly allowance unused as a safety margin
    dailyCap: 'auto' as 'auto' | number, // 'auto' = (monthlyFree − reserve) ÷ days in month
  },
  sla: {
    confirmRoutineMin: 15,
    confirmUrgentMin: 5,
    assignMin: 30,
    acceptTimeoutMin: 15,
    lateAfterMin: 10,
    overtimePct: 25,
    reminderBeforeMin: [120, 30],
  },
  email: {
    fromName: process.env.EMAIL_FROM_NAME ?? 'Unico Hospitals · Home Care',
    replyTo: '',
    departmentCc: process.env.DEPARTMENT_EMAIL ? [process.env.DEPARTMENT_EMAIL] : ([] as string[]),
    sendPatientEmails: true,
    sendDepartmentReport: true,
    dailyDigest: true,
  },
  whatsapp: { defaultCountry: process.env.WA_DEFAULT_COUNTRY ?? '880', mode: 'deeplink' as 'deeplink' | 'cloud' | 'baileys', autoSend: true },
  /** extra email addresses that get a copy of the patient's message per event (Settings → Notification rules) */
  emailCopies: {} as Record<string, string[]>,
  /** WhatsApp alert to the heads of department when a new request comes in (Settings → Notification rules).
   *  category = ServiceType.category (Doctor · Nursing · Lab · Physio); several people per category. */
  hodAlerts: {
    enabled: true,
    groups: [] as HodGroup[], // empty = the four built-in category groups (lib/services/hod.ts)
    contacts: [] as HodContact[],
  },
  features: {
    autoAssign: false,
    gpsRequiredCheckIn: false, // no GPS fix → check-in blocked
    checkInGpsLocked: true, // GPS always attached at check-in; staff get no switch to turn it off
    liveTracking: true, // share location from Start journey to check-in (and back to the hospital)
    shareTrackingWithPatient: true, // the patient gets a live tracking link on WhatsApp
    otpConfirmation: true,
    transportModule: true,
    pettyCash: true,
  },
  /** Unico car paperwork (Settings → Fleet & drivers): Vehicle Requisition Form (Annex-3) + gate pass, sent on WhatsApp */
  transportDocs: {
    sendRequisition: true, // as soon as a Unico car is requested
    sendGatePass: true, // when a car is allotted (also to the driver)
    vehicleType: 'Car' as 'Car' | 'Micro' | 'Ambulance',
    approverId: '' as string, // dept. head whose signature is stamped (only if they allowed it on their account)
    emailCopy: '' as string, // e.g. ruhul.security@unicohospitals.com
    /** on-call security supervisors; from/to = shift (HH:MM, may cross midnight); empty = always on call */
    supervisors: [] as { id: string; name: string; phone: string; from: string; to: string; active: boolean }[],
  },
  /** short WhatsApp update after each visit (lib/services/updates.ts) */
  visitUpdates: {
    enabled: true,
    toHods: true, // heads of the visit's service categories (hodAlerts list)
    extra: [] as { id: string; name: string; phone: string }[], // more WhatsApp numbers (managers…)
    toPatient: false, // a friendlier summary for the patient
  },
  quietHours: { from: '22:00', to: '07:00' },
  /** E4 notification matrix: event → recipients → channels */
  notificationRules: {
    REQUEST_CREATED: { HC_ADMIN: ['inapp', 'push'] },
    CONFIRMED: { PATIENT: ['whatsapp', 'email'], FRONT_DESK: ['inapp'] },
    ASSIGNED: { STAFF: ['push', 'inapp', 'whatsapp'], PATIENT: ['whatsapp'], HC_ADMIN: ['inapp'] },
    ACCEPTED: { HC_ADMIN: ['inapp', 'push'] },
    DECLINED: { HC_ADMIN: ['inapp', 'push'] },
    REMINDER: { STAFF: ['push'], PATIENT: ['whatsapp'] },
    EN_ROUTE: { PATIENT: ['whatsapp'], HC_ADMIN: ['inapp'] },
    CHECK_IN: { PATIENT: ['whatsapp'], HC_ADMIN: ['inapp'] },
    ABNORMAL_VITALS: { HC_ADMIN: ['push', 'inapp'], DOCTOR: ['push'] },
    COMPLETED: { HC_ADMIN: ['inapp'], PATIENT: ['whatsapp', 'email'], DEPARTMENT: ['email'] },
    OVERDUE: { STAFF: ['push'], HC_ADMIN: ['push', 'inapp'] },
    RESCHEDULED: { STAFF: ['push'], PATIENT: ['whatsapp'] },
    CANCELLED: { STAFF: ['push'], PATIENT: ['whatsapp'] },
    DAILY_DIGEST: { HC_ADMIN: ['email'], VIEWER: ['email'] },
  } as Record<string, Record<string, string[]>>,
}
export type Settings = typeof DEFAULT_SETTINGS

function merge(base: any, over: any): any {
  if (Array.isArray(base) || typeof base !== 'object' || base == null) return over ?? base
  const out: any = { ...base }
  for (const k of Object.keys(over ?? {})) out[k] = merge(base[k], over[k])
  return out
}

const SETTINGS_TTL_MS = 30_000

/** Settings rows are read at most every 30 s per instance; saveSetting() clears that at once on this instance.
 *  Only the configuration keys are loaded (the collection also holds OTPs and other runtime rows). */
export const getSettings = cache(async function getSettings(): Promise<Settings> {
  const rows = await memo('settings:rows', SETTINGS_TTL_MS, () => Setting.find({ key: { $in: Object.keys(DEFAULT_SETTINGS) } }).select('key value').lean<any[]>())
  const over: any = {}
  for (const r of rows) over[r.key] = r.value
  return merge(DEFAULT_SETTINGS, structuredClone(over)) // a fresh object per request, never the shared cached rows
})

/** Map notification types used in code onto the event rows of the E4 matrix. */
const EVENT_ALIAS: Record<string, string> = { ESCALATION: 'DECLINED', TRANSPORT: 'TRANSPORT_ASSIGNED' }

/**
 * E4 notification matrix check: rules[event][recipient] = channels[].
 * Anything not configured is allowed, so new events never go silent by accident.
 * For in-app delivery, either 'inapp' or 'push' counts (the web app has no separate push).
 */
export function ruleAllows(rules: Settings['notificationRules'], event: string, recipient: string, channel: 'inapp' | 'push' | 'email' | 'whatsapp') {
  const row = rules?.[EVENT_ALIAS[event] ?? event]
  const list = row?.[recipient]
  if (!Array.isArray(list)) return true
  if (event === 'ASSIGNED' && recipient === 'STAFF') return true // locked on (plan §5.7)
  return channel === 'inapp' ? list.includes('inapp') || list.includes('push') : list.includes(channel)
}

export async function saveSetting(key: keyof Settings | string, value: unknown, userId?: string) {
  await Setting.updateOne({ key }, { value, updatedBy: userId }, { upsert: true })
  forget('settings:')
}
