import 'server-only'
import { HomecareRequest, MessageLog, ServiceType, User, Vehicle } from '../models'
import { getSettings, HOD_CATEGORIES, type HodContact, type HodGroup } from '../settings'
import { CAR_EVENTS, TRANSPORT_MODE_LABEL, VISIT_EVENTS, type AlertEvent, type VisitEvent } from '../constants'
import { getTemplate, renderTemplate, waNumber } from '../messaging'
import { canQueue } from '../wa/status'
import { dur, time as fmtTime } from '../format'

// Department-head alert groups (Settings → Notification rules). The four built-in groups follow a service category
// (Doctor / Nursing / Lab / Physio) so new services join automatically; custom groups list service codes or "ALL".
// A person can be narrowed to some of the group's services.

const CAT_TITLE: Record<string, string> = { Doctor: 'Doctor service', Nursing: 'Nursing service', Lab: 'Phlebotomy / Lab', Physio: 'Physiotherapy' }

/** Built-in Security and Transport groups: always present, can't be deleted, hear about the car and claims. */
const SYSTEM_GROUPS: HodGroup[] = [
  // coordinators who follow every visit as it happens — any number of people
  { id: 'sys-live', system: 'live', name: 'Live updates — coordinators', services: 'ALL', events: ['NEW_REQUEST', ...VISIT_EVENTS, 'CAR_ALLOTTED', 'CAR_OWN'], active: true },
  { id: 'sys-security', system: 'security', name: 'Security', services: [], events: [...CAR_EVENTS], active: true },
  { id: 'sys-transport', system: 'transport', name: 'Transport', services: [], events: [...CAR_EVENTS], active: true },
]

/** What a group hears about; groups saved before events existed get new requests only. */
export const eventsOf = (g: HodGroup): AlertEvent[] => {
  const ev: AlertEvent[] = g.events?.length ? g.events : ['NEW_REQUEST']
  // groups saved before "own transport" existed: whoever hears about a cancelled trip also hears that no car goes
  return ev.includes('CAR_CANCELLED') && !ev.includes('CAR_OWN') ? [...ev, 'CAR_OWN'] : ev
}

/** Groups + contacts, upgrading the first version (contacts keyed by category, no groups) on the fly. */
export function hodConfig(cfg: { enabled: boolean; groups?: HodGroup[]; contacts: HodContact[] }) {
  const saved: HodGroup[] = cfg.groups?.length ? cfg.groups : HOD_CATEGORIES.map((c) => ({ id: `cat-${c}`, name: CAT_TITLE[c], category: c, services: [], message: '', active: true }))
  const groups = [...saved, ...SYSTEM_GROUPS.filter((g) => !saved.some((x) => x.id === g.id))]
    .map((g) => {
      const sys = SYSTEM_GROUPS.find((x) => x.id === g.id)
      return sys ? { ...g, system: sys.system } : g
    })
    .sort((a, b) => Number(b.system === 'live') - Number(a.system === 'live')) // the live group first
  const contacts = (cfg.contacts ?? []).map((c) => ({ ...c, groupId: c.groupId || (c.category ? `cat-${c.category}` : groups[0]?.id) }))
  return { enabled: cfg.enabled, groups, contacts }
}

type Recipient = { name: string; designation: string; phone: string; group: HodGroup }

/** Everyone (one per phone) in an active group that hears about `event`. Car / claim events ignore services. */
export async function groupRecipients(event: Exclude<AlertEvent, 'NEW_REQUEST'>): Promise<Recipient[]> {
  const s = await getSettings()
  const { enabled, groups, contacts } = hodConfig(s.hodAlerts as any)
  if (!enabled) return []
  const seen = new Set<string>()
  const out: Recipient[] = []
  for (const g of groups) {
    if (!g.active || !eventsOf(g).includes(event)) continue
    for (const c of contacts) {
      if (c.groupId !== g.id || !c.active) continue
      const n = waNumber(c.phone)
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push({ name: c.name, designation: c.designation, phone: c.phone, group: g })
    }
  }
  return out
}

export type CarEvent = 'CAR_REQUESTED' | 'CAR_ALLOTTED' | 'CAR_CHANGED' | 'CAR_CANCELLED' | 'CAR_OUT' | 'CAR_BACK' | 'CAR_OWN'
const CAR_TEMPLATE: Record<CarEvent, string> = {
  CAR_OWN: 'car_own',
  CAR_REQUESTED: 'car_requested',
  CAR_ALLOTTED: 'car_allotted',
  CAR_CHANGED: 'car_changed',
  CAR_CANCELLED: 'car_cancelled',
  CAR_OUT: 'car_out',
  CAR_BACK: 'car_back',
}

/**
 * WhatsApp the Security / Transport (or any) groups about a Unico car event on a request. CAR_OUT / CAR_BACK go once
 * per request and number (the driver's leg stamp and the team's live tracking can both report them).
 */
export async function carAlert(event: CarEvent, requestId: unknown, extra: { reason?: string; at?: Date; amount?: string } = {}) {
  const key = CAR_TEMPLATE[event]
  const r = await HomecareRequest.findById(requestId).lean<any>()
  if (!r?.transport?.needed) return 0
  if (event !== 'CAR_OWN' && r.transport.mode && r.transport.mode !== 'UNICO_CAR') return 0 // own transport: no hospital car involved
  const to = await groupRecipients(event)
  if (!to.length || !(await canQueue())) return 0
  if ((await getTemplate(key)).isActive === false) return 0
  const [vehicle, driver] = await Promise.all([
    r.transport.vehicleId ? Vehicle.findById(r.transport.vehicleId).select('name plate').lean<any>() : null,
    r.transport.driverId ? User.findById(r.transport.driverId).select('name phone').lean<any>() : null,
  ])
  const { templateVars } = await import('./requests')
  const vars = {
    ...(await templateVars(r)),
    vehicle: vehicle ? [vehicle.name, vehicle.plate].filter(Boolean).join(' · ') : 'not allotted yet',
    driverName: driver?.name ?? 'not allotted yet',
    driverPhone: driver?.phone ?? '',
    pickupTime: r.transport.pickupAt ? fmtTime(r.transport.pickupAt) : '—',
    returnTime: r.transport.returnAt ? fmtTime(r.transport.returnAt) : '—',
    eventTime: fmtTime(extra.at ?? new Date()),
    reason: extra.reason ?? r.cancellation?.reason ?? '',
    transportMode: (TRANSPORT_MODE_LABEL as Record<string, string>)[r.transport.mode] ?? r.transport.mode ?? '',
    amount: extra.amount ?? '',
  }
  const { queueWhatsApp } = await import('../wa/service')
  let sent = 0
  for (const c of to) {
    if ((event === 'CAR_OUT' || event === 'CAR_BACK') && (await MessageLog.exists({ requestId: r._id, templateKey: key, to: waNumber(c.phone) }))) continue
    const { text } = await renderTemplate(key, { ...vars, staffName: c.name, designation: c.designation, group: c.group.name })
    await queueWhatsApp({ to: c.phone, toName: `${c.name} (${c.group.name})`, text, templateKey: key, requestId: r._id })
    sent++
  }
  return sent
}

/** Who should hear about a new request: one entry per phone number, with the group whose message to use. */
export async function hodRecipients(r: { services?: { serviceTypeId?: unknown; code?: string }[] }) {
  const s = await getSettings()
  const { enabled, groups, contacts } = hodConfig(s.hodAlerts as any)
  if (!enabled || !contacts.length) return []
  const codes = (r.services ?? []).map((x) => x.code).filter(Boolean) as string[]
  const types = await ServiceType.find({ _id: { $in: (r.services ?? []).map((x) => x.serviceTypeId).filter(Boolean) } }).select('code category').lean<any[]>()
  const cats = new Set(types.map((t) => String(t.category ?? '').toLowerCase()))
  const groupHits = (g: HodGroup) => {
    if (!g.active || !eventsOf(g).includes('NEW_REQUEST')) return [] as string[]
    if (g.system === 'live') return codes.length ? codes : ['*'] // every request, even "other service" only
    if (g.services === 'ALL') return codes
    if (g.category) return types.filter((t) => String(t.category ?? '').toLowerCase() === g.category!.toLowerCase()).map((t) => t.code)
    return codes.filter((c) => (g.services as string[]).includes(c))
  }
  const seen = new Set<string>()
  const out: { name: string; designation: string; phone: string; group: HodGroup }[] = []
  for (const g of groups) {
    const hits = groupHits(g)
    if (!hits.length && !(g.category && eventsOf(g).includes('NEW_REQUEST') && cats.has(g.category.toLowerCase()))) continue
    for (const c of contacts) {
      if (c.groupId !== g.id || !c.active) continue
      if (c.services?.length && !hits.includes('*') && !c.services.some((x) => hits.includes(x))) continue // person limited to some services
      const n = waNumber(c.phone)
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push({ name: c.name, designation: c.designation, phone: c.phone, group: g })
    }
  }
  return out
}

// ---------------------------------------------------------------- live updates at every step
const VISIT_ICON: Record<VisitEvent, string> = {
  CONFIRMED: '✅',
  ASSIGNED: '👥',
  ACCEPTED: '👍',
  DECLINED: '⛔',
  NO_RESPONSE: '⏰',
  EN_ROUTE: '🚗',
  CHECKED_IN: '📍',
  CHECKED_OUT: '🏁',
  COMPLETED: '✅',
  BACK_AT_HOSPITAL: '🏥',
  RESCHEDULED: '🗓',
  CANCELLED: '❌',
}

export type VisitAlertExtra = { by?: string; staffName?: string; reason?: string; minutes?: number; at?: Date; onBehalf?: boolean }

/** One line saying what just happened, e.g. "📍 HC-261102-0002 · Checked in 2:05 PM (4 min late)". */
function visitLine(event: VisitEvent, r: any, x: VisitAlertExtra, team: string, trackLink: string) {
  const t = (d?: Date | string | null) => (d ? fmtTime(d) : fmtTime(new Date()))
  const tl = r.timeline ?? {}
  const by = x.by ? ` by ${x.by}` : ''
  const when = r.scheduledAt ? `${fmtTime(r.scheduledAt)}, ${new Date(r.scheduledAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })}` : 'time to be fixed'
  const what: Record<VisitEvent, string> = {
    CONFIRMED: `Confirmed for ${when}${by}`,
    ASSIGNED: `Assigned to ${team || 'staff'}${by}`,
    ACCEPTED: x.onBehalf ? `Accepted for ${x.staffName ?? 'staff'}${by}` : `Accepted by ${x.staffName ?? team ?? 'staff'} at ${t(tl.acceptedAt)}`,
    DECLINED: `Declined by ${x.staffName ?? 'staff'}${x.reason ? ` — ${x.reason}` : ''} · needs a new assignment`,
    NO_RESPONSE: `No reply from ${x.staffName ?? 'staff'} in ${x.minutes ?? '?'} min — keep waiting, accept for them or reassign`,
    EN_ROUTE: `On the way · left ${t(tl.enRouteAt)}${x.onBehalf ? by : ''}${trackLink ? `\nTrack live: ${trackLink}` : ''}`,
    CHECKED_IN: `Checked in ${t(tl.checkInAt)}${r.visit?.lateMin ? ` (${r.visit.lateMin} min late)` : ''}${x.onBehalf ? by : ''}`,
    CHECKED_OUT: `Checked out ${t(tl.checkOutAt)}${r.visit?.durationMin ? ` · visit ${dur(r.visit.durationMin)}` : ''}`,
    COMPLETED: `Visit completed${tl.checkInAt && tl.checkOutAt ? ` · ${fmtTime(tl.checkInAt)}–${fmtTime(tl.checkOutAt)}` : ''}${x.onBehalf ? by : ''}`,
    BACK_AT_HOSPITAL: `Team back at hospital ${t(x.at ?? r.returnTrip?.reachedAt)}${tl.enRouteAt ? ` · out ${dur(Math.round(((x.at ?? new Date()).getTime() - new Date(tl.enRouteAt).getTime()) / 60000))}` : ''}`,
    RESCHEDULED: `Rescheduled to ${when}${by}`,
    CANCELLED: `Cancelled${by}${x.reason ? ` — ${x.reason}` : ''}`,
  }
  return `${VISIT_ICON[event]} ${r.requestNo} · ${what[event]}`
}

/**
 * WhatsApp the groups that follow `event` (the built-in "Live updates — coordinators" group by default) the moment a
 * visit moves on. One message per number; never throws.
 */
export async function visitAlert(event: VisitEvent, requestId: unknown, extra: VisitAlertExtra = {}) {
  try {
    const to = await groupRecipients(event)
    if (!to.length || !(await canQueue())) return 0
    if ((await getTemplate('visit_live')).isActive === false) return 0
    const r = await HomecareRequest.findById(requestId).select('+tracking.shareToken').lean<any>()
    if (!r) return 0
    const ids = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean)
    const staff = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean<any[]>() : []
    const team = ids.map((id) => staff.find((u) => String(u._id) === String(id))?.name).filter(Boolean).join(', ')
    const { templateVars } = await import('./requests')
    const vars = await templateVars(r)
    const update = visitLine(event, r, { staffName: extra.staffName ?? staff.find((u) => String(u._id) === String(r.assignment?.primaryStaffId))?.name, ...extra }, team, event === 'EN_ROUTE' ? vars.trackLink : '')
    const area = r.patientSnapshot?.area || String(r.patientSnapshot?.address ?? '').split(',').slice(-2).join(',').trim()
    const { queueWhatsApp } = await import('../wa/service')
    let sent = 0
    for (const c of to) {
      const { text } = await renderTemplate('visit_live', { ...vars, update, team: team || 'not assigned yet', area, staffName: c.name, designation: c.designation, group: c.group.name })
      await queueWhatsApp({ to: c.phone, toName: `${c.name} (${c.group.name})`, text, templateKey: 'visit_live', requestId: r._id })
      sent++
    }
    return sent
  } catch (e) {
    console.error('[visit alert]', event, e)
    return 0
  }
}
