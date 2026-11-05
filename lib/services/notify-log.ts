import 'server-only'
import { HomecareRequest, MessageLog, Notification, User } from '../models'
import { notifyOptions, type NotifyEvent, type NotifyPreviewInput } from './notify'

// Request page → Notified tab: who heard about each step of a visit (WhatsApp, email, in-app) and who did not —
// people left unticked in "Notify on WhatsApp", opted out, not on WhatsApp, or a failed send.

/**
 * Remember who a person ticked in "Notify on WhatsApp" and who was offered but left out (names kept, so the record
 * still reads right after Settings change). Called first thing in the action's background work. Never throws.
 */
export async function recordNotifyDecision(r: any, events: NotifyEvent[], only: Set<string> | undefined, userId: string, extra: Partial<NotifyPreviewInput> = {}) {
  if (!only) return
  try {
    const { items } = await notifyOptions({ events, requestId: String(r._id), ...extra }, r)
    const left = items.filter((i) => !only.has(i.key)).map((i) => ({ key: i.key, name: i.name, role: i.role, kind: i.kind, group: i.group, note: i.note }))
    const entry = { event: events[events.length - 1], at: new Date(), by: userId, sent: [...only], left }
    await HomecareRequest.updateOne({ _id: r._id }, { $push: { notifyLog: { $each: [entry], $slice: -100 } } })
  } catch (e) {
    console.error('[notify decision]', e)
  }
}

export type NotifyRow = { name: string; role?: string; channel: 'WHATSAPP' | 'EMAIL' | 'INAPP'; status: string; at: string; reason?: string; seenAt?: string }
export type NotifyStep = { step: string; label: string; at: string; by?: string; picked: boolean; notified: NotifyRow[]; notNotified: NotifyRow[] }

const STEP_LABEL: Record<string, string> = {
  NEW_REQUEST: 'New request',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Staff assigned',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  NO_RESPONSE: 'No reply from staff',
  EN_ROUTE: 'On the way',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  COMPLETED: 'Completed',
  BACK_AT_HOSPITAL: 'Back at hospital',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  CAR_DOCS: 'Car requisition & gate pass',
  CAR_REQUESTED: 'Car requested',
  CAR_ALLOTTED: 'Car & driver allotted',
  CAR_CHANGED: 'Trip time changed',
  CAR_CANCELLED: 'Trip cancelled',
  CAR_OWN: 'Own transport · petty cash',
  CAR_OUT: 'Car left hospital',
  CAR_BACK: 'Car back at hospital',
  VISIT_SUMMARY: 'Visit report & summary',
  BILL: 'Bill',
  REMINDER: 'Reminder',
  OVERDUE: 'Overdue',
  ABNORMAL_VITALS: 'Abnormal vitals',
  CHAT: 'Chat',
  APPROVAL: 'Approval',
  OTHER: 'Other messages',
}
const TEMPLATE_STEP: Record<string, string> = {
  hod_new_request: 'NEW_REQUEST',
  patient_received: 'NEW_REQUEST',
  patient_confirmed: 'CONFIRMED',
  patient_assigned: 'ASSIGNED',
  staff_assigned: 'ASSIGNED',
  patient_rescheduled: 'RESCHEDULED',
  staff_rescheduled: 'RESCHEDULED',
  patient_cancelled: 'CANCELLED',
  staff_cancelled: 'CANCELLED',
  patient_en_route: 'EN_ROUTE',
  patient_arrived: 'CHECKED_IN',
  patient_completed: 'COMPLETED',
  vehicle_requisition: 'CAR_DOCS',
  gate_pass: 'CAR_DOCS',
  car_requested: 'CAR_REQUESTED',
  car_allotted: 'CAR_ALLOTTED',
  car_changed: 'CAR_CHANGED',
  car_cancelled: 'CAR_CANCELLED',
  car_own: 'CAR_OWN',
  petty_cash: 'CAR_OWN',
  car_out: 'CAR_OUT',
  car_back: 'CAR_BACK',
  visit_update: 'VISIT_SUMMARY',
  patient_visit_summary: 'VISIT_SUMMARY',
  dept_visit_report: 'VISIT_SUMMARY',
  admin_escalation: 'NO_RESPONSE',
  patient_bill: 'BILL',
  staff_bill: 'BILL',
}
/** in-app notification types that are named differently from the step */
const NOTE_STEP: Record<string, string> = { REQUEST_CREATED: 'NEW_REQUEST', ESCALATION: 'NO_RESPONSE', TRANSPORT: 'CAR_ALLOTTED', SYSTEM: 'OTHER' }
/** "visit_live" texts say which step they are about ("📍 Checked in 2:05 PM"). */
const LIVE_STEP: [RegExp, string][] = [
  [/Confirmed for/, 'CONFIRMED'],
  [/Assigned to/, 'ASSIGNED'],
  [/Accepted/, 'ACCEPTED'],
  [/Declined by/, 'DECLINED'],
  [/No reply from/, 'NO_RESPONSE'],
  [/On the way/, 'EN_ROUTE'],
  [/Checked in/, 'CHECKED_IN'],
  [/Checked out/, 'CHECKED_OUT'],
  [/Visit completed/, 'COMPLETED'],
  [/back at hospital/i, 'BACK_AT_HOSPITAL'],
  [/Rescheduled to/, 'RESCHEDULED'],
  [/Cancelled/, 'CANCELLED'],
]
const GAP_MS = 3 * 60_000 // notices of one step sent within 3 min are one moment on the timeline
const NOT_SENT = new Set(['SKIPPED', 'FAILED'])

/** Every notice about a request grouped by visit step, newest first, with who was left out. */
export async function notifyTimeline(r: any): Promise<NotifyStep[]> {
  const [logs, notes] = await Promise.all([
    MessageLog.find({ requestId: r._id, channel: { $in: ['WHATSAPP', 'EMAIL'] } }).sort({ at: 1 }).limit(500).select('channel to toName templateKey renderedText status error at initiatedBy').lean<any[]>(),
    Notification.find({ 'data.requestId': r._id }).sort({ createdAt: 1 }).limit(500).select('userId type createdAt readAt').lean<any[]>(),
  ])
  const ids = [...new Set([...logs.map((l) => l.initiatedBy), ...notes.map((n) => n.userId), ...(r.notifyLog ?? []).map((d: any) => d.by)].filter(Boolean).map(String))]
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name role').lean<any[]>() : []
  const who = (id: unknown) => users.find((u) => String(u._id) === String(id))

  const nodes: (NotifyStep & { last: number })[] = []
  const nodeFor = (step: string, at: Date): NotifyStep & { last: number } => {
    const t = at.getTime()
    const hit = [...nodes].reverse().find((n) => n.step === step && Math.abs(t - n.last) <= GAP_MS)
    if (hit) {
      hit.last = Math.max(hit.last, t)
      if (t < +new Date(hit.at)) hit.at = at.toISOString()
      return hit
    }
    const n: NotifyStep & { last: number } = { step, label: STEP_LABEL[step] ?? step.replace(/_/g, ' ').toLowerCase(), at: at.toISOString(), picked: false, notified: [], notNotified: [], last: t }
    nodes.push(n)
    return n
  }

  for (const l of logs) {
    const step = l.templateKey === 'visit_live' ? (LIVE_STEP.find(([rx]) => rx.test(String(l.renderedText ?? '').split('\n')[0]))?.[1] ?? 'OTHER') : (TEMPLATE_STEP[l.templateKey] ?? 'OTHER')
    const at = new Date(l.at)
    const n = nodeFor(step, at)
    if (!n.by && l.initiatedBy) n.by = who(l.initiatedBy)?.name
    const row: NotifyRow = { name: l.toName || l.to || '—', channel: l.channel, status: l.status, at: at.toISOString() }
    if (NOT_SENT.has(l.status)) n.notNotified.push({ ...row, reason: l.error || (l.status === 'FAILED' ? 'Failed to send' : 'Skipped') })
    else n.notified.push(row)
  }
  for (const x of notes) {
    const u = who(x.userId)
    const at = new Date(x.createdAt)
    const step = NOTE_STEP[x.type] ?? (STEP_LABEL[x.type] ? x.type : 'OTHER')
    nodeFor(step, at).notified.push({ name: u?.name ?? 'Staff member', role: u?.role, channel: 'INAPP', status: x.readAt ? 'SEEN' : 'DELIVERED', at: at.toISOString(), seenAt: x.readAt ? new Date(x.readAt).toISOString() : undefined })
  }
  // people offered in "Notify on WhatsApp" but left unticked
  for (const d of r.notifyLog ?? []) {
    const at = new Date(d.at)
    const n = nodeFor(d.event, at)
    const by = who(d.by)?.name
    n.picked = true
    if (by) n.by = by
    for (const p of d.left ?? []) n.notNotified.push({ name: p.name, role: [p.role, p.group].filter(Boolean).join(' · '), channel: 'WHATSAPP', status: 'UNTICKED', at: at.toISOString(), reason: p.note || `Unticked${by ? ` by ${by}` : ''}` })
  }
  return nodes.map(({ last: _last, ...n }) => n).sort((a, b) => +new Date(b.at) - +new Date(a.at))
}
