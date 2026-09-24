import 'server-only'
import { Setting } from './models'
import { SLOTS } from './constants'

/** Non-secret configuration editable from Settings (W15 / A5). Secrets stay in env vars. */
export const DEFAULT_SETTINGS = {
  general: {
    hospitalName: 'Unico Hospitals PLC',
    department: 'Family Medicine · Home Care',
    hospitalPhone: process.env.HOSPITAL_PHONE ?? '+880 9666 710 710',
    address: 'Plot 1, Road 12, Dhaka',
    workingHours: { from: '08:00', to: '20:00' },
    slots: [...SLOTS] as string[],
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
  whatsapp: { defaultCountry: process.env.WA_DEFAULT_COUNTRY ?? '880', mode: 'deeplink' as 'deeplink' | 'cloud' },
  features: { autoAssign: false, gpsRequiredCheckIn: false, otpConfirmation: true, transportModule: true, pettyCash: true },
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

export async function getSettings(): Promise<Settings> {
  const rows = await Setting.find({}).lean<any[]>()
  const over: any = {}
  for (const r of rows) over[r.key] = r.value
  return merge(DEFAULT_SETTINGS, over)
}

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
}
