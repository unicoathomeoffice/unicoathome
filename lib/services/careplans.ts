import 'server-only'
import { z } from 'zod'
import { CarePlan, HomecareRequest, Patient, ServiceType, isOid } from '../models'
import { audit } from '../audit'
import { bad, forbidden, notFound } from '../api'
import { can } from '../constants'
import { isoDay, dhakaDate } from '../format'
import { createRequest, cancel, withPeople } from './requests'
import type { SessionUser } from '../auth'

type Meta = { ip?: string; userAgent?: string; client?: string }

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_OCCURRENCES = 60

export const CarePlanInput = z.object({
  patientId: z.string().refine(isOid, 'Pick a patient'),
  serviceCode: z.string().min(2),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
  slot: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  weeks: z.coerce.number().int().min(1).max(26),
  orderedBy: z.string().optional(),
  title: z.string().optional(),
  priority: z.enum(['ROUTINE', 'URGENT']).optional(),
  instructions: z.string().optional(),
  transportNeeded: z.boolean().optional(),
})
export const CarePlanPatch = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  title: z.string().optional(),
  orderedBy: z.string().optional(),
})
export const AddVisitInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/).optional() })

/** Every Dhaka calendar day (YYYY-MM-DD) in the plan window that falls on one of daysOfWeek. */
export function planDates(startDate: string, weeks: number, daysOfWeek: number[]) {
  const out: string[] = []
  const start = new Date(`${startDate}T00:00:00Z`)
  for (let i = 0; i < weeks * 7 && out.length < MAX_OCCURRENCES; i++) {
    const d = new Date(start.getTime() + i * 86400_000)
    if (daysOfWeek.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function canManagePlan(user: SessionUser, plan: any) {
  return can(user, 'requests.manage') || String(plan.createdBy) === user.id
}

async function occurrenceInput(plan: any, date: string, time: string | undefined, user: SessionUser, extra: { priority?: string; instructions?: string; transportNeeded?: boolean } = {}) {
  const st = await ServiceType.findById(plan.serviceTypeId).select('code').lean<any>()
  if (!st) throw bad('The plan service no longer exists')
  return {
    patientId: String(plan.patientId),
    serviceCodes: [st.code],
    tests: [],
    priority: (extra.priority as any) ?? 'ROUTINE',
    preferredDate: date,
    preferredTime: time ?? plan.time,
    preferredSlot: plan.slot,
    complaint: [plan.title, extra.instructions].filter(Boolean).join(' · ') || undefined,
    referringDoctor: plan.orderedBy,
    transportNeeded: extra.transportNeeded,
    source: 'APP' as const,
    remarks: `Care plan · ${plan.title ?? 'recurring visits'}`,
    carePlanId: String(plan._id),
    ignoreDuplicate: true,
  }
}

/** Creates the plan and one NEW request per occurrence (each confirmed later by the coordinator as usual). */
export async function createCarePlan(input: z.infer<typeof CarePlanInput>, user: SessionUser, meta: Meta = {}) {
  if (!can(user, 'requests.create')) throw forbidden()
  const patient = await Patient.findOne({ _id: input.patientId, deletedAt: null }).select('name').lean<any>()
  if (!patient) throw notFound('Patient')
  const st = await ServiceType.findOne({ code: input.serviceCode }).lean<any>()
  if (!st) throw bad('Unknown service', { serviceCode: 'Unknown' })
  const today = isoDay()
  const dates = planDates(input.startDate, input.weeks, input.daysOfWeek).filter((d) => d > today || (d === today && dhakaDate(d, input.time).getTime() > Date.now()))
  if (!dates.length) throw bad('No visit dates fall in this plan window — check the start date and days')
  const plan = await CarePlan.create({
    patientId: input.patientId,
    title: input.title || `${st.name} plan`,
    serviceTypeId: st._id,
    daysOfWeek: [...new Set(input.daysOfWeek)].sort(),
    slot: input.slot,
    time: input.time,
    startDate: new Date(`${input.startDate}T00:00:00+06:00`),
    weeks: input.weeks,
    orderedBy: input.orderedBy,
    status: 'ACTIVE',
    requestIds: [],
    createdBy: user.id,
  })
  const ids: string[] = []
  for (const d of dates) {
    const r = await createRequest(await occurrenceInput(plan, d, input.time, user, input), user, meta)
    ids.push(String(r._id))
  }
  plan.requestIds = ids
  await plan.save()
  await audit(user, 'care_plan.create', 'care_plan', plan._id, { after: { patient: patient.name, service: st.name, daysOfWeek: plan.daysOfWeek, time: plan.time, weeks: plan.weeks, occurrences: ids.length }, label: plan.title }, meta)
  return { plan, count: ids.length }
}

export async function loadPlan(id: string, user: SessionUser) {
  if (!isOid(id)) throw notFound('Care plan')
  const plan = await CarePlan.findById(id)
  if (!plan) throw notFound('Care plan')
  if (!can(user, 'requests.create') && !can(user, 'requests.readAll')) throw forbidden()
  return plan
}

/** Plan + its occurrences (requests with this carePlanId), staff joined. Lean / plain-ready. */
export async function planDetail(id: string, user: SessionUser) {
  const plan = (await loadPlan(id, user)).toObject()
  const [patient, service, requests] = await Promise.all([
    Patient.findById(plan.patientId).select('name ageYears gender phone uhid address').lean<any>(),
    ServiceType.findById(plan.serviceTypeId).select('code name defaultDurationMin').lean<any>(),
    HomecareRequest.find({ $or: [{ carePlanId: plan._id }, { _id: { $in: plan.requestIds ?? [] } }], deletedAt: null })
      .select('requestNo status priority scheduledAt slot assignment patientSnapshot services transport createdBy')
      .sort({ scheduledAt: 1 })
      .lean<any[]>(),
  ])
  await withPeople(requests)
  return { plan, patient, service, requests, canManage: canManagePlan(user, plan) }
}

const FUTURE_CANCELLABLE = ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED']

export async function updatePlan(id: string, input: z.infer<typeof CarePlanPatch>, user: SessionUser, meta: Meta = {}) {
  const plan = await loadPlan(id, user)
  if (!canManagePlan(user, plan)) throw forbidden('Only the coordinator or the plan author can change this plan')
  const before = { status: plan.status, title: plan.title, orderedBy: plan.orderedBy }
  let cancelled = 0
  let created = 0
  if (input.title != null) plan.title = input.title
  if (input.orderedBy != null) plan.orderedBy = input.orderedBy
  if (input.status && input.status !== plan.status) {
    if (plan.status === 'ENDED') throw bad('This plan has ended. Create a new plan instead.')
    if (input.status === 'PAUSED' || input.status === 'ENDED') {
      const future = await HomecareRequest.find({ carePlanId: plan._id, status: { $in: FUTURE_CANCELLABLE }, scheduledAt: { $gt: new Date() }, deletedAt: null })
      for (const r of future) {
        await cancel(r, { reason: input.status === 'PAUSED' ? 'Care plan paused' : 'Care plan ended' }, user, meta)
        cancelled++
      }
    } else if (input.status === 'ACTIVE') {
      // Resume: re-create the remaining occurrences that were cancelled by the pause
      const today = isoDay()
      const all = planDates(isoDay(plan.startDate), plan.weeks ?? 1, plan.daysOfWeek ?? [])
      const live = await HomecareRequest.find({ carePlanId: plan._id, status: { $ne: 'CANCELLED' }, deletedAt: null }).select('scheduledAt').lean<any[]>()
      const covered = new Set(live.map((r) => isoDay(r.scheduledAt)))
      for (const d of all) {
        if (d < today || covered.has(d)) continue
        if (dhakaDate(d, plan.time).getTime() <= Date.now()) continue
        const r = await createRequest(await occurrenceInput(plan, d, plan.time, user), user, meta)
        plan.requestIds.push(r._id)
        created++
      }
    }
    plan.status = input.status
  }
  await plan.save()
  await audit(user, input.status ? `care_plan.${input.status.toLowerCase()}` : 'care_plan.update', 'care_plan', plan._id, { before, after: { status: plan.status, title: plan.title, orderedBy: plan.orderedBy, cancelled, created }, label: plan.title }, meta)
  return { cancelled, created }
}

/** One extra occurrence on a given day (the "Add a visit" action). */
export async function addPlanVisit(id: string, input: z.infer<typeof AddVisitInput>, user: SessionUser, meta: Meta = {}) {
  const plan = await loadPlan(id, user)
  if (!can(user, 'requests.create')) throw forbidden()
  if (plan.status !== 'ACTIVE') throw bad('Resume the plan before adding visits')
  const r = await createRequest(await occurrenceInput(plan, input.date, input.time, user), user, meta)
  plan.requestIds.push(r._id)
  await plan.save()
  await audit(user, 'care_plan.add_visit', 'care_plan', plan._id, { after: { date: input.date, time: input.time ?? plan.time, requestNo: r.requestNo }, label: plan.title }, meta)
  return r
}

export async function listPlans(user: SessionUser, f: { patientId?: string; status?: string } = {}) {
  if (!can(user, 'requests.create') && !can(user, 'requests.readAll')) throw forbidden()
  const q: any = {}
  if (f.patientId && isOid(f.patientId)) q.patientId = f.patientId
  if (f.status) q.status = { $in: f.status.split(',') }
  const plans = await CarePlan.find(q).sort({ status: 1, createdAt: -1 }).limit(100).lean<any[]>()
  const [patients, services, reqs] = await Promise.all([
    Patient.find({ _id: { $in: plans.map((p) => p.patientId) } }).select('name ageYears gender address.area').lean<any[]>(),
    ServiceType.find({ _id: { $in: plans.map((p) => p.serviceTypeId) } }).select('code name').lean<any[]>(),
    HomecareRequest.find({ carePlanId: { $in: plans.map((p) => p._id) }, deletedAt: null }).select('carePlanId status scheduledAt').lean<any[]>(),
  ])
  const now = Date.now()
  return plans.map((p) => {
    const mine = reqs.filter((r) => String(r.carePlanId) === String(p._id) && r.status !== 'CANCELLED')
    const next = mine.filter((r) => r.scheduledAt && new Date(r.scheduledAt).getTime() > now).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))[0]
    return {
      ...p,
      patient: patients.find((x) => String(x._id) === String(p.patientId)) ?? null,
      service: services.find((x) => String(x._id) === String(p.serviceTypeId)) ?? null,
      total: mine.length,
      done: mine.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length,
      nextAt: next?.scheduledAt ?? null,
    }
  })
}
