import 'server-only'
import { z } from 'zod'
import { HomecareRequest, Patient, isOid } from '../models'
import { audit, type Meta } from '../audit'
import { bad, forbidden } from '../api'
import { can } from '../constants'
import { isoDay } from '../format'
import { TestItemInput } from '../schemas'
import type { SessionUser } from '../auth'

// Household visits: 2–3 patients at the same address, each with their own request (own services, tests, bill), done as
// ONE trip — the same time, the same team, one Unico car. They share `household.key`; the first is the lead (the car
// requisition is made from the lead and names everyone). Confirm / assign / accept / reschedule on any member is carried
// to the others (lib/services/requests.ts calls follow() with a re-entry guard). Visit steps stay per patient.

const NOT_STARTED = ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED']
const hm = (d?: Date | string | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : undefined)

export const HouseholdAddInput = z.object({
  patientId: z.string().refine(isOid).optional(),
  patient: z.object({ name: z.string().trim().min(2), ageYears: z.coerce.number().int().min(0).max(120).optional(), gender: z.enum(['M', 'F', 'O']).optional(), phone: z.string().trim().optional() }).optional(),
  serviceCodes: z.array(z.string()).default([]),
  otherService: z.string().trim().max(80).optional(),
  tests: z.array(z.string()).default([]),
  testItems: z.array(TestItemInput).max(60).optional(),
})

/** The other requests of the household (not deleted). */
export async function householdMembers(r: any, opts: { includeSelf?: boolean } = {}) {
  if (!r.household?.key) return []
  return HomecareRequest.find({ 'household.key': r.household.key, deletedAt: null, ...(opts.includeSelf ? {} : { _id: { $ne: r._id } }) })
}

/** Add another patient at this address to the visit — their own request, linked, following this one's time and team. */
export async function addHouseholdMember(lead: any, input: z.infer<typeof HouseholdAddInput>, user: SessionUser, meta: Meta) {
  if (!can(user, 'requests.create')) throw forbidden()
  if (!NOT_STARTED.includes(lead.status)) throw bad('Add family members before the visit starts')
  if (!input.patientId && !input.patient) throw bad('Pick or enter the patient')
  if (!input.serviceCodes.length && !input.otherService) throw bad('Pick at least one service', { serviceCodes: 'Required' })
  if (input.patientId && String(input.patientId) === String(lead.patientId)) throw bad('That is the same patient')
  const members = await householdMembers(lead, { includeSelf: true })
  if (members.length >= 4) throw bad('A household visit has at most 4 patients')
  const leadPatient = await Patient.findById(lead.patientId).select('phone address').lean<any>()
  const key = lead.household?.key ?? String(lead._id)
  if (!lead.household?.key) await HomecareRequest.updateOne({ _id: lead._id }, { $set: { household: { key, lead: true } } })

  const { createRequest, confirm, assign } = await import('./requests')
  const quiet = { ...meta, client: 'household' }
  const r: any = await createRequest(
    {
      ...(input.patientId
        ? { patientId: input.patientId }
        : {
            patient: {
              name: input.patient!.name,
              ageYears: input.patient!.ageYears,
              gender: input.patient!.gender,
              // the family's number and address (same house)
              phone: input.patient!.phone || leadPatient?.phone || lead.patientSnapshot?.phone,
              address: { full: leadPatient?.address?.full || lead.patientSnapshot?.address || 'Same address', area: leadPatient?.address?.area, house: leadPatient?.address?.house, flat: leadPatient?.address?.flat, landmark: leadPatient?.address?.landmark, lat: leadPatient?.address?.lat, lng: leadPatient?.address?.lng },
            },
          }),
      serviceCodes: input.serviceCodes,
      otherService: input.otherService,
      tests: input.tests,
      testItems: input.testItems,
      priority: lead.priority,
      preferredDate: lead.scheduledAt ? isoDay(lead.scheduledAt) : lead.preferred?.date,
      preferredTime: hm(lead.scheduledAt) ?? lead.preferred?.time,
      preferredSlot: lead.slot,
      transportNeeded: !!lead.transport?.needed,
      source: lead.source,
      remarks: `Household visit with ${lead.requestNo}`,
      ignoreDuplicate: true,
      notify: [],
    } as any,
    user,
    quiet,
  )
  r.set('household', { key, lead: false })
  if (lead.transport?.timesSetAt) {
    r.set('transport.pickupAt', lead.transport.pickupAt)
    r.set('transport.returnAt', lead.transport.returnAt)
    r.set('transport.timesSetAt', lead.transport.timesSetAt)
    r.set('transport.timesSetBy', lead.transport.timesSetBy)
  }
  await r.save()
  // follow the lead: confirmed, and the same team when it has one
  if (['CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED'].includes(lead.status) && lead.scheduledAt) {
    await confirm(r, { date: isoDay(lead.scheduledAt), time: hm(lead.scheduledAt), notify: [] } as any, user, quiet, { quiet: true, household: true } as any)
    if (lead.assignment?.primaryStaffId) {
      await assign(
        r,
        {
          primaryStaffId: String(lead.assignment.primaryStaffId),
          secondaryStaffIds: (lead.assignment.secondaryStaffIds ?? []).map(String).filter((x: string) => !(lead.assignment.supportStaffIds ?? []).map(String).includes(x)),
          supportStaffIds: (lead.assignment.supportStaffIds ?? []).map(String),
          instructions: lead.assignment.instructions,
          ...(lead.transport?.timesSetAt && { pickupTime: hm(lead.transport.pickupAt), returnTime: hm(lead.transport.returnAt) }),
          acceptNow: lead.status === 'ACCEPTED',
          notify: [],
        } as any,
        user,
        quiet,
        { household: true },
      )
      // the team already accepted the trip: this patient's visit is accepted with it
      if (lead.status === 'ACCEPTED' && r.status === 'ASSIGNED') {
        r.status = 'ACCEPTED'
        r.set('timeline.acceptedAt', new Date())
        r.set('assignment.acceptedAt', new Date())
        r.set('assignment.respondBy', undefined)
        await r.save()
      }
    }
  }
  // the car requisition already went out for the lead: an updated one names this patient too (waits in the Outbox)
  if (lead.transport?.requisitionSentAt && r.transport?.needed) {
    const leadId = lead._id
    const { background } = await import('../messaging')
    background(async () => (await import('./transport-docs')).carRequested(leadId, user.id, { updated: true }))
  }
  await audit(user, 'household.add', 'request', lead._id, { after: { added: r.requestNo, patient: r.patientSnapshot?.name, key }, label: lead.requestNo }, meta)
  return { id: String(r._id), requestNo: r.requestNo as string }
}

/**
 * Carry a step to the rest of the household. Called right after the step succeeded on `r`; `run` does it on one member
 * (members already past that step are skipped by the step's own rules). Errors on a member never undo the step on `r`.
 */
export async function follow(r: any, statuses: string[], run: (m: any) => Promise<unknown>) {
  if (!r.household?.key) return 0
  const others = await HomecareRequest.find({ 'household.key': r.household.key, _id: { $ne: r._id }, deletedAt: null, status: { $in: statuses } })
  let n = 0
  for (const m of others) {
    try {
      await run(m)
      n++
    } catch {}
  }
  return n
}

/** For the request page: the household's members with their services and status. */
export async function householdView(r: any) {
  if (!r.household?.key) return null
  const all = await HomecareRequest.find({ 'household.key': r.household.key, deletedAt: null }).select('requestNo status patientSnapshot.name services household').sort({ createdAt: 1 }).lean<any[]>()
  if (all.length < 2) return null
  return all.map((m) => ({ id: String(m._id), requestNo: m.requestNo as string, name: m.patientSnapshot?.name ?? '', services: (m.services ?? []).map((s: any) => s.name).join(', '), status: m.status as string, lead: !!m.household?.lead, self: String(m._id) === String(r._id) }))
}

/**
 * One car per household trip: does this visit make the car paperwork? Yes for a visit on its own, and for the lead —
 * or, when the lead was cancelled, the first patient still on the trip.
 */
export async function carriesCar(r: any) {
  if (!r.household?.key) return true
  const active = await HomecareRequest.find({ 'household.key': r.household.key, deletedAt: null, status: { $ne: 'CANCELLED' }, 'transport.needed': true }).select('household createdAt').sort({ createdAt: 1 }).lean<any[]>()
  const carrier = active.find((m) => m.household?.lead) ?? active[0]
  return !carrier || String(carrier._id) === String(r._id)
}

/** Requisition purpose for a household (lead only): every patient and service. */
export async function householdPurpose(r: any) {
  if (!r.household?.key) return null
  const all = await HomecareRequest.find({ 'household.key': r.household.key, deletedAt: null, status: { $ne: 'CANCELLED' } }).select('patientSnapshot.name services').sort({ createdAt: 1 }).lean<any[]>()
  if (all.length < 2) return null
  return `Home care visit (household, ${all.length} patients) · ` + all.map((m) => `${m.patientSnapshot?.name ?? ''}: ${(m.services ?? []).map((s: any) => s.name).join(', ')}`).join(' · ')
}
