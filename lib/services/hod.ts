import 'server-only'
import { HomecareRequest, MessageLog, ServiceType, User, Vehicle } from '../models'
import { getSettings, HOD_CATEGORIES, type HodContact, type HodGroup } from '../settings'
import { CAR_EVENTS, type AlertEvent } from '../constants'
import { getTemplate, renderTemplate, waNumber } from '../messaging'
import { isPaired } from '../wa/status'
import { time as fmtTime } from '../format'

// Department-head alert groups (Settings → Notification rules). The four built-in groups follow a service category
// (Doctor / Nursing / Lab / Physio) so new services join automatically; custom groups list service codes or "ALL".
// A person can be narrowed to some of the group's services.

const CAT_TITLE: Record<string, string> = { Doctor: 'Doctor service', Nursing: 'Nursing service', Lab: 'Phlebotomy / Lab', Physio: 'Physiotherapy' }

/** Built-in Security and Transport groups: always present, can't be deleted, hear about the car and claims. */
const SYSTEM_GROUPS: HodGroup[] = [
  { id: 'sys-security', system: 'security', name: 'Security', services: [], events: [...CAR_EVENTS], active: true },
  { id: 'sys-transport', system: 'transport', name: 'Transport', services: [], events: [...CAR_EVENTS], active: true },
]

/** What a group hears about; groups saved before events existed get new requests only. */
export const eventsOf = (g: HodGroup): AlertEvent[] => (g.events?.length ? g.events : ['NEW_REQUEST'])

/** Groups + contacts, upgrading the first version (contacts keyed by category, no groups) on the fly. */
export function hodConfig(cfg: { enabled: boolean; groups?: HodGroup[]; contacts: HodContact[] }) {
  const saved: HodGroup[] = cfg.groups?.length ? cfg.groups : HOD_CATEGORIES.map((c) => ({ id: `cat-${c}`, name: CAT_TITLE[c], category: c, services: [], message: '', active: true }))
  const groups = [...saved, ...SYSTEM_GROUPS.filter((g) => !saved.some((x) => x.id === g.id))].map((g) => {
    const sys = SYSTEM_GROUPS.find((x) => x.id === g.id)
    return sys ? { ...g, system: sys.system } : g
  })
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

export type CarEvent = 'CAR_REQUESTED' | 'CAR_ALLOTTED' | 'CAR_CHANGED' | 'CAR_CANCELLED' | 'CAR_OUT' | 'CAR_BACK'
const CAR_TEMPLATE: Record<CarEvent, string> = {
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
export async function carAlert(event: CarEvent, requestId: unknown, extra: { reason?: string; at?: Date } = {}) {
  const key = CAR_TEMPLATE[event]
  const r = await HomecareRequest.findById(requestId).lean<any>()
  if (!r?.transport?.needed) return 0
  if (r.transport.mode && r.transport.mode !== 'UNICO_CAR') return 0 // own transport: no hospital car involved
  const to = await groupRecipients(event)
  if (!to.length || !(await isPaired())) return 0
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
      if (c.services?.length && !c.services.some((x) => hits.includes(x))) continue // person limited to some services
      const n = waNumber(c.phone)
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push({ name: c.name, designation: c.designation, phone: c.phone, group: g })
    }
  }
  return out
}
