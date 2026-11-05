import 'server-only'
import { z } from 'zod'
import { Patient, ServiceType, User, Vehicle, isOid } from '../models'
import { getSettings, ruleAllows } from '../settings'
import { waNumber } from '../messaging'
import { canQueue } from '../wa/status'
import type { AlertEvent } from '../constants'

// "Notify on WhatsApp": who would get a WhatsApp for an action a person is about to take, with the Settings
// defaults pre-ticked. The action then sends only to the ticked keys ('patient' + WhatsApp numbers), see
// `notify` on the action inputs in lib/services/requests.ts. Steps nobody clicks keep the Settings defaults.

export const NOTIFY_EVENTS = ['NEW_REQUEST', 'CONFIRMED', 'ASSIGNED', 'RESCHEDULED', 'CANCELLED', 'CAR_ALLOTTED'] as const
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]

export const NotifyPreviewInput = z.object({
  events: z.array(z.enum(NOTIFY_EVENTS)).min(1),
  requestId: z.string().optional(),
  /** new request (no record yet) */
  serviceCodes: z.array(z.string()).optional(),
  patient: z.object({ name: z.string().optional(), phone: z.string().optional() }).optional(),
  transportNeeded: z.boolean().optional(),
  /** the care team being picked (assign) */
  staffIds: z.array(z.string()).optional(),
  /** car being allotted */
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
})
export type NotifyPreviewInput = z.infer<typeof NotifyPreviewInput>

export type NotifyKind = 'patient' | 'staff' | 'driver' | 'supervisor' | 'group'
export type NotifyOption = { key: string; kind: NotifyKind; name: string; role: string; phone: string; group?: string; defaultOn: boolean; note?: string; what: string[] }

/** The matrix cell names WhatsApp explicitly (new recipients never turn on by themselves). */
const ruleSays = (rules: Record<string, Record<string, string[]>>, event: string, who: string) => !!rules?.[event]?.[who]?.includes('whatsapp')

export async function notifyOptions(input: NotifyPreviewInput, r?: any) {
  const s = await getSettings()
  const rules = s.notificationRules
  const { groupRecipients, hodRecipients } = await import('./hod')
  const { onCallSupervisors } = await import('./transport-docs')
  const out = new Map<string, NotifyOption>()
  const add = (o: Omit<NotifyOption, 'what'>, what: string) => {
    if (!o.key) return
    const had = out.get(o.key)
    if (had) {
      had.defaultOn ||= o.defaultOn
      if (!had.what.includes(what)) had.what.push(what)
    } else out.set(o.key, { ...o, what: [what] })
  }
  const groups = async (event: AlertEvent, what: string) => {
    for (const c of event === 'NEW_REQUEST' ? await hodRecipients({ services }) : await groupRecipients(event))
      add({ key: waNumber(c.phone), kind: 'group', name: c.name, role: c.designation, phone: c.phone, group: c.group.name, defaultOn: true }, what)
  }

  // ---- what the action is about
  let services: { serviceTypeId?: unknown; code?: string }[] = r?.services ?? []
  if (!r && input.serviceCodes?.length) services = (await ServiceType.find({ code: { $in: input.serviceCodes } }).select('code').lean<any[]>()).map((t) => ({ serviceTypeId: t._id, code: t.code }))
  const transport = r ? !!r.transport?.needed : !!input.transportNeeded
  const unicoCar = transport && (!r?.transport?.mode || r.transport.mode === 'UNICO_CAR')
  const teamIds = (input.staffIds ?? [r?.assignment?.primaryStaffId, ...(r?.assignment?.secondaryStaffIds ?? [])]).filter((x) => x && isOid(String(x)))
  const team = teamIds.length ? await User.find({ _id: { $in: teamIds } }).select('name phone whatsapp role').lean<any[]>() : []

  let patient: { name: string; phone: string; optOut: boolean } | null = null
  if (r) {
    const p = await Patient.findById(r.patientId).select('name phone whatsapp consent').lean<any>()
    if (p) patient = { name: p.name, phone: p.whatsapp || p.phone, optOut: p.consent?.whatsapp === false }
  } else if (input.patient?.phone) patient = { name: input.patient.name || 'Patient', phone: input.patient.phone, optOut: false }
  const patientRow = (event: string, what: string) => {
    if (!patient || !waNumber(patient.phone)) return
    const on = s.whatsapp.autoSend !== false && ruleAllows(rules, event, 'PATIENT', 'whatsapp')
    add({ key: 'patient', kind: 'patient', name: patient.name, role: 'Patient', phone: patient.phone, defaultOn: on && !patient.optOut, note: patient.optOut ? 'Opted out of WhatsApp' : undefined }, what)
  }
  const staffRows = (people: any[], event: string, who: 'STAFF' | 'DRIVER', what: string) => {
    for (const u of people) {
      const phone = u.whatsapp || u.phone
      add({ key: waNumber(phone), kind: who === 'DRIVER' ? 'driver' : 'staff', name: u.name, role: who === 'DRIVER' ? 'Driver' : 'Care team', phone: phone ?? '', defaultOn: ruleSays(rules, event, who), note: waNumber(phone) ? undefined : 'No phone number' }, what)
    }
  }
  const supervisors = async (what: string, on: boolean) => {
    for (const x of await onCallSupervisors()) add({ key: waNumber(x.phone), kind: 'supervisor', name: x.name, role: 'Security supervisor (on call)', phone: x.phone, defaultOn: on }, what)
    for (const c of await groupRecipients('CAR_DOCS')) add({ key: waNumber(c.phone), kind: 'group', name: c.name, role: c.designation, phone: c.phone, group: c.group.name, defaultOn: on }, what)
  }

  for (const ev of input.events) {
    if (ev === 'NEW_REQUEST') {
      if (!r?.carePlanId) await groups('NEW_REQUEST', 'New request')
    } else if (ev === 'CONFIRMED') {
      patientRow('CONFIRMED', 'Confirmation')
      await groups('CONFIRMED', 'Confirmed')
    } else if (ev === 'ASSIGNED') {
      patientRow('ASSIGNED', 'Care team')
      staffRows(team, 'ASSIGNED', 'STAFF', 'Assignment')
      await groups('ASSIGNED', 'Assigned')
      if (unicoCar) {
        await supervisors('Vehicle requisition', s.transportDocs.sendRequisition !== false)
        if (!r?.transport?.requisitionSentAt) await groups('CAR_REQUESTED', 'Car requested')
      }
    } else if (ev === 'RESCHEDULED') {
      patientRow('RESCHEDULED', 'New time')
      staffRows(team, 'RESCHEDULED', 'STAFF', 'Rescheduled')
      await groups('RESCHEDULED', 'Rescheduled')
      if (transport) await groups('CAR_CHANGED', 'Trip time changed')
    } else if (ev === 'CANCELLED') {
      patientRow('CANCELLED', 'Cancelled')
      const driver = r?.transport?.driverId ? await User.find({ _id: r.transport.driverId }).select('name phone whatsapp').lean<any[]>() : []
      staffRows(team, 'CANCELLED', 'STAFF', 'Cancelled')
      staffRows(driver, 'CANCELLED', 'DRIVER', 'Cancelled')
      await groups('CANCELLED', 'Cancelled')
      if (transport) await groups('CAR_CANCELLED', 'Trip cancelled')
    } else if (ev === 'CAR_ALLOTTED') {
      await supervisors('Requisition + gate pass', s.transportDocs.sendRequisition !== false || s.transportDocs.sendGatePass !== false)
      let driverId = input.driverId
      if (!driverId && input.vehicleId && isOid(input.vehicleId)) driverId = (await Vehicle.findById(input.vehicleId).select('driverId').lean<any>())?.driverId
      if (driverId && isOid(String(driverId))) {
        const d = await User.findById(driverId).select('name phone whatsapp').lean<any>()
        if (d) add({ key: waNumber(d.whatsapp || d.phone), kind: 'driver', name: d.name, role: 'Driver', phone: d.whatsapp || d.phone, defaultOn: s.transportDocs.sendGatePass !== false }, 'Gate pass')
      }
      await groups('CAR_ALLOTTED', 'Car allotted')
    }
  }
  return { paired: await canQueue(), items: [...out.values()] }
}

