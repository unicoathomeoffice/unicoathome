import 'server-only'
import { z } from 'zod'
import { CarePlan, HomecareRequest, Patient, Setting, User, isOid } from '../models'
import { audit, type Meta } from '../audit'
import { bad, forbidden, notFound } from '../api'
import { can } from '../constants'
import { dhakaDate, isoDay } from '../format'
import { waNumber } from '../messaging'
import { addDays, describeSchedule, scheduleDates, type SchedEnd, type SchedPattern } from '../schedule-dates'
import { assign, cancel, confirm, createRequest } from './requests'
import type { SessionUser } from '../auth'

// Repeating schedules (care plans with a `pattern`). A schedule is made from an existing request — visit #1 — and copies
// its patient, services, tests, car, duration and notes. Visits are generated 14 days ahead, each confirmed at the
// schedule time and assigned to the schedule's team when it has one (staff still Accept, and get their bag link).
// rollSchedules() keeps them going (from the periodic sweep, at most hourly). Every step is audited.

const HORIZON_DAYS = 14
const OPEN = ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED'] // not started yet
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const hhmm = z.string().regex(/^\d{2}:\d{2}$/)

const Pattern = z
  .object({ kind: z.enum(['DAILY', 'WEEKDAYS', 'EVERY_N']), daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(), everyDays: z.coerce.number().int().min(1).max(60).optional() })
  .refine((p) => p.kind !== 'WEEKDAYS' || (p.daysOfWeek?.length ?? 0) > 0, 'Pick at least one weekday')
  .refine((p) => p.kind !== 'EVERY_N' || (p.everyDays ?? 0) >= 1, 'Every how many days?')
const End = z
  .object({ kind: z.enum(['COUNT', 'UNTIL', 'ONGOING']), count: z.coerce.number().int().min(1).max(200).optional(), until: ymd.optional() })
  .refine((e) => e.kind !== 'COUNT' || (e.count ?? 0) >= 1, 'How many visits?')
  .refine((e) => e.kind !== 'UNTIL' || !!e.until, 'Until which date?')

export const ScheduleInput = z.object({ fromRequestId: z.string().refine(isOid, 'Invalid request'), pattern: Pattern, end: End, time: hhmm.optional(), title: z.string().trim().max(80).optional() })
/** "repeat" on POST /requests: the same as a schedule, made from the request in the same call (web + app) */
export const RepeatInput = ScheduleInput.omit({ fromRequestId: true })
export const ScheduleEdit = z.object({ pattern: Pattern.optional(), end: End.optional(), time: hhmm.optional(), title: z.string().trim().max(80).optional() })
export const ScheduleAction = z.object({ action: z.enum(['pause', 'resume', 'stop', 'skip']), date: ymd.optional(), reason: z.string().trim().max(160).optional() })

const hm = (d?: Date | string | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : null)
const ruleOf = (plan: any) => ({ start: isoDay(plan.startDate), pattern: plan.pattern as SchedPattern, end: plan.end as SchedEnd, skip: plan.skipDates ?? [] })
const canRun = (user: SessionUser) => can(user, 'requests.manage')

/** The person a schedule acts as when it makes visits on its own (its creator), as a session-like actor. */
async function actorOf(plan: any): Promise<SessionUser | null> {
  const u = await User.findById(plan.createdBy).select('name role roles status deletedAt').lean<any>()
  if (!u || u.status !== 'ACTIVE' || u.deletedAt) return null
  return { id: String(u._id), name: u.name, role: u.role, roles: [u.role, ...(u.roles ?? [])], permissions: null, client: 'web', jti: 'schedule' } as any
}

async function teamNumbers(ids: unknown[]) {
  const people = await User.find({ _id: { $in: ids.filter(Boolean) } }).select('phone whatsapp').lean<any[]>()
  return people.map((p) => waNumber(p.whatsapp || p.phone)).filter(Boolean)
}

/** Make one visit of the schedule on a date: create → confirm (quiet) → assign the team (if set). */
async function makeVisit(plan: any, date: string, actor: SessionUser, meta: Meta) {
  const services: any[] = plan.services ?? []
  const r: any = await createRequest(
    {
      patientId: String(plan.patientId),
      serviceCodes: services.filter((s) => s.code !== 'OTHER').map((s) => s.code),
      otherService: services.filter((s) => s.code === 'OTHER').map((s) => s.name).join(', ') || undefined,
      tests: (plan.tests ?? []).filter((t: string) => !(plan.testItems ?? []).some((i: any) => i.name === t)),
      testItems: plan.testItems ?? [],
      priority: (plan.priority as any) ?? 'ROUTINE',
      preferredDate: date,
      preferredTime: plan.time,
      expectedDurationMin: plan.durationMin ?? undefined,
      complaint: plan.complaint ?? undefined,
      estimatedFee: plan.fee ?? undefined,
      transportNeeded: !!plan.car?.needed,
      source: 'PHONE',
      remarks: `Schedule · ${describeSchedule(plan.pattern, plan.end)}`,
      carePlanId: String(plan._id),
      ignoreDuplicate: true,
      notify: [],
    } as any,
    actor,
    { ...meta, client: 'schedule' },
  )
  await confirm(r, { date, time: plan.time, notify: [] } as any, actor, { ...meta, client: 'schedule' }, { quiet: true })
  const t = plan.team
  if (t?.primaryStaffId) {
    const teamIds = [t.primaryStaffId, ...(t.secondaryStaffIds ?? [])]
    await assign(
      r,
      {
        primaryStaffId: String(t.primaryStaffId),
        secondaryStaffIds: (t.secondaryStaffIds ?? []).map(String),
        supportStaffIds: (t.supportStaffIds ?? []).map(String),
        instructions: plan.instructions ?? undefined,
        ...(plan.car?.needed && plan.car.pickupTime ? { pickupTime: plan.car.pickupTime, returnTime: plan.car.returnTime || undefined } : {}),
        notify: await teamNumbers(teamIds), // assignment + bag link to the team — waits in the WhatsApp Outbox for approval
      } as any,
      actor,
      { ...meta, client: 'schedule' },
    )
  }
  return r
}

/** Create the visits the schedule still needs in the next 14 days. Safe to call often (one run per plan at a time). */
export async function generate(planId: unknown, meta: Meta = {}) {
  const claim = await CarePlan.findOneAndUpdate(
    { _id: planId, status: 'ACTIVE', 'pattern.kind': { $exists: true }, $or: [{ rollingAt: null }, { rollingAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] },
    { $set: { rollingAt: new Date() } },
    { new: true },
  )
  if (!claim) return 0
  const plan: any = claim
  let made = 0
  try {
    const actor = await actorOf(plan)
    if (!actor) return 0
    const today = isoDay()
    const to = addDays(today, HORIZON_DAYS)
    const existing = await HomecareRequest.find({ carePlanId: plan._id, deletedAt: null }).select('scheduledAt preferred').lean<any[]>()
    const covered = new Set(existing.map((r) => (r.scheduledAt ? isoDay(r.scheduledAt) : r.preferred?.date)).filter(Boolean))
    for (const d of scheduleDates(ruleOf(plan), today, to)) {
      if (covered.has(d) || dhakaDate(d, plan.time).getTime() <= Date.now()) continue
      try {
        const r = await makeVisit(plan, d, actor, meta)
        await CarePlan.updateOne({ _id: plan._id }, { $push: { requestIds: r._id } })
        made++
      } catch (e: any) {
        await audit(null, 'schedule.visit_failed', 'care_plan', plan._id, { after: { date: d, error: String(e?.message ?? e).slice(0, 200) }, label: plan.title })
      }
    }
    // a counted / dated schedule with no dates left (and none waiting) has ended
    const left = plan.end?.kind === 'ONGOING' ? 1 : scheduleDates(ruleOf(plan), addDays(today, 1), addDays(today, 800)).length
    const ended = left === 0 && !(await HomecareRequest.exists({ carePlanId: plan._id, deletedAt: null, status: { $in: OPEN } }))
    await CarePlan.updateOne({ _id: plan._id }, { $set: { generatedUntil: to, ...(ended ? { status: 'ENDED' } : {}) } })
    if (made) await audit(null, 'schedule.generate', 'care_plan', plan._id, { after: { made, until: to }, label: plan.title })
  } finally {
    await CarePlan.updateOne({ _id: plan._id }, { $set: { rollingAt: null } })
  }
  return made
}

/** Keep every active schedule 14 days ahead — called from the sweep, at most once an hour across all servers. */
export async function rollSchedules() {
  const claim = await Setting.updateOne(
    { key: 'schedules:rollAt', $or: [{ value: { $exists: false } }, { value: { $lt: new Date(Date.now() - 55 * 60_000).toISOString() } }] },
    { $set: { value: new Date().toISOString() } },
    { upsert: false },
  ).catch(() => null)
  if (!claim?.modifiedCount) {
    // first run ever: create the marker
    const exists = await Setting.exists({ key: 'schedules:rollAt' })
    if (exists) return 0
    await Setting.create({ key: 'schedules:rollAt', value: new Date().toISOString() }).catch(() => null)
  }
  const plans = await CarePlan.find({ status: 'ACTIVE', 'pattern.kind': { $exists: true } }).select('_id').lean<any[]>()
  let made = 0
  for (const p of plans) made += await generate(p._id).catch(() => 0)
  return made
}

/** Turn a request into visit #1 of a new repeating schedule, and create the next visits. */
export async function createSchedule(input: z.infer<typeof ScheduleInput>, user: SessionUser, meta: Meta = {}) {
  if (!canRun(user)) throw forbidden()
  const r = await HomecareRequest.findOne({ _id: input.fromRequestId, deletedAt: null })
  if (!r) throw notFound('Request')
  if (r.carePlanId) throw bad('This request is already part of a schedule')
  const start = r.scheduledAt ? isoDay(r.scheduledAt) : r.preferred?.date || isoDay()
  const time = input.time ?? hm(r.scheduledAt) ?? r.preferred?.time ?? '10:00'
  if (input.end.kind === 'UNTIL' && input.end.until! < start) throw bad('The end date is before the first visit')
  const patient = await Patient.findById(r.patientId).select('name').lean<any>()
  const services = (r.services ?? []).map((s: any) => ({ serviceTypeId: s.serviceTypeId, code: s.code, name: s.name }))
  const plan = await CarePlan.create({
    patientId: r.patientId,
    title: input.title || `${services.map((s: any) => s.name).join(', ') || 'Visits'} · ${patient?.name ?? ''}`.trim(),
    serviceTypeId: services[0]?.serviceTypeId,
    services,
    tests: r.tests ?? [],
    testItems: r.testItems ?? [],
    pattern: input.pattern,
    end: input.end,
    time,
    slot: r.slot,
    startDate: new Date(`${start}T00:00:00+06:00`),
    weeks: undefined,
    durationMin: r.expectedDurationMin,
    instructions: r.assignment?.instructions,
    complaint: r.clinical?.complaint,
    fee: r.billing?.estimatedFee,
    priority: r.priority,
    team: r.assignment?.primaryStaffId ? { primaryStaffId: r.assignment.primaryStaffId, secondaryStaffIds: r.assignment.secondaryStaffIds ?? [], supportStaffIds: r.assignment.supportStaffIds ?? [] } : undefined,
    car: { needed: !!r.transport?.needed, pickupTime: r.transport?.timesSetAt ? hm(r.transport.pickupAt) : undefined, returnTime: r.transport?.timesSetAt && r.transport.returnAt ? hm(r.transport.returnAt) : undefined },
    status: 'ACTIVE',
    requestIds: [r._id],
    createdBy: user.id,
    householdKey: (r as any).household?.key,
  })
  await HomecareRequest.updateOne({ _id: r._id }, { $set: { carePlanId: plan._id } })
  await audit(user, 'schedule.create', 'care_plan', plan._id, { after: { from: r.requestNo, pattern: input.pattern, end: input.end, time }, label: plan.title }, meta)
  const made = await generate(plan._id, meta)
  return { id: String(plan._id), made }
}

/** Assign drawer "use this team for every visit in this schedule": save it and assign the other un-assigned visits. */
export async function applyTeamToSeries(planId: unknown, input: any, user: SessionUser, meta: Meta, exceptId: unknown) {
  const plan = await CarePlan.findById(planId)
  if (!plan) return 0
  plan.team = { primaryStaffId: input.primaryStaffId, secondaryStaffIds: input.secondaryStaffIds ?? [], supportStaffIds: input.supportStaffIds ?? [] }
  if (input.pickupTime) plan.car = { needed: true, pickupTime: input.pickupTime, returnTime: input.returnTime }
  if (input.instructions) plan.instructions = input.instructions
  await plan.save()
  let n = 0
  const others = await HomecareRequest.find({ carePlanId: plan._id, _id: { $ne: exceptId }, deletedAt: null, status: { $in: ['CONFIRMED', 'RESCHEDULED'] }, 'assignment.primaryStaffId': null, scheduledAt: { $gt: new Date() } })
  for (const r of others) {
    try {
      await assign(r, { ...input, applyToSeries: false, date: undefined, time: undefined, slot: undefined, acceptNow: undefined } as any, user, meta)
      n++
    } catch {}
  }
  await audit(user, 'schedule.team', 'care_plan', plan._id, { after: { primaryStaffId: input.primaryStaffId, assigned: n }, label: plan.title }, meta)
  return n
}

async function cancelFuture(plan: any, reason: string, user: SessionUser, meta: Meta, onDate?: string) {
  const future = await HomecareRequest.find({ carePlanId: plan._id, deletedAt: null, status: { $in: OPEN }, scheduledAt: { $gt: new Date() } })
  let n = 0
  for (const r of future) {
    if (onDate && isoDay(r.scheduledAt) !== onDate) continue
    await cancel(r, { reason }, user, meta)
    n++
  }
  return n
}

/** Pause · resume · stop · skip one date. Pausing / stopping cancels the visits not started yet. */
export async function scheduleAction(id: string, input: z.infer<typeof ScheduleAction>, user: SessionUser, meta: Meta = {}) {
  if (!canRun(user)) throw forbidden()
  if (!isOid(id)) throw notFound('Schedule')
  const plan = await CarePlan.findById(id)
  if (!plan) throw notFound('Schedule')
  let cancelled = 0
  let made = 0
  if (input.action === 'skip') {
    if (!input.date) throw bad('Which date?')
    plan.skipDates = [...new Set([...(plan.skipDates ?? []), input.date])]
    await plan.save()
    cancelled = await cancelFuture(plan, input.reason || 'Skipped in the schedule', user, meta, input.date)
  } else if (input.action === 'pause' || input.action === 'stop') {
    if (plan.status === 'ENDED') throw bad('This schedule has ended')
    plan.status = input.action === 'pause' ? 'PAUSED' : 'ENDED'
    await plan.save()
    cancelled = await cancelFuture(plan, input.reason || (input.action === 'pause' ? 'Schedule paused' : 'Schedule stopped'), user, meta)
  } else {
    if (plan.status === 'ENDED') throw bad('This schedule has ended — make a new one')
    plan.status = 'ACTIVE'
    await plan.save()
    made = await generate(plan._id, meta)
  }
  await audit(user, `schedule.${input.action}`, 'care_plan', plan._id, { after: { status: plan.status, date: input.date, cancelled, made, reason: input.reason }, label: plan.title }, meta)
  return { status: plan.status, cancelled, made }
}

/** Change the days / end / time: visits not started yet are replaced by ones that follow the new rule. */
export async function editSchedule(id: string, input: z.infer<typeof ScheduleEdit>, user: SessionUser, meta: Meta = {}) {
  if (!canRun(user)) throw forbidden()
  if (!isOid(id)) throw notFound('Schedule')
  const plan = await CarePlan.findById(id)
  if (!plan) throw notFound('Schedule')
  const before = { pattern: plan.pattern, end: plan.end, time: plan.time, title: plan.title }
  if (input.pattern) plan.pattern = input.pattern
  if (input.end) plan.end = input.end
  if (input.time) plan.time = input.time
  if (input.title) plan.title = input.title
  await plan.save()
  let cancelled = 0
  if (input.pattern || input.end || input.time) cancelled = await cancelFuture(plan, 'Schedule changed', user, meta)
  const made = plan.status === 'ACTIVE' ? await generate(plan._id, meta) : 0
  await audit(user, 'schedule.edit', 'care_plan', plan._id, { before, after: { pattern: plan.pattern, end: plan.end, time: plan.time, title: plan.title, cancelled, made }, label: plan.title }, meta)
  return { cancelled, made }
}

/** The Schedules page: every repeating schedule with its next visit, progress and team. */
export async function listSchedules(user: SessionUser) {
  if (!can(user, 'requests.readAll') && !canRun(user)) throw forbidden()
  const plans = await CarePlan.find({ 'pattern.kind': { $exists: true } }).sort({ status: 1, updatedAt: -1 }).limit(200).lean<any[]>()
  const [patients, reqs, staff] = await Promise.all([
    Patient.find({ _id: { $in: plans.map((p) => p.patientId) } }).select('name ageYears gender address.area').lean<any[]>(),
    HomecareRequest.find({ carePlanId: { $in: plans.map((p) => p._id) }, deletedAt: null }).select('carePlanId status scheduledAt').lean<any[]>(),
    User.find({ _id: { $in: plans.map((p) => p.team?.primaryStaffId).filter(Boolean) } }).select('name').lean<any[]>(),
  ])
  const now = Date.now()
  return plans.map((p) => {
    const mine = reqs.filter((r) => String(r.carePlanId) === String(p._id) && r.status !== 'CANCELLED')
    const next = mine.filter((r) => r.scheduledAt && new Date(r.scheduledAt).getTime() > now).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))[0]
    const pt = patients.find((x) => String(x._id) === String(p.patientId))
    return {
      id: String(p._id),
      title: p.title as string,
      status: p.status as string,
      rule: describeSchedule(p.pattern, p.end),
      time: p.time as string,
      services: (p.services ?? []).map((s: any) => s.name),
      patient: pt ? { id: String(pt._id), name: pt.name, area: pt.address?.area ?? null } : null,
      team: staff.find((u) => String(u._id) === String(p.team?.primaryStaffId))?.name ?? null,
      done: mine.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length,
      planned: mine.length,
      total: p.end?.kind === 'COUNT' ? p.end.count : null,
      nextAt: next?.scheduledAt ? new Date(next.scheduledAt).toISOString() : null,
      car: !!p.car?.needed,
    }
  })
}

/** One schedule with its visits (past and coming) and the next planned dates not created yet. */
export async function scheduleDetail(id: string, user: SessionUser) {
  if (!can(user, 'requests.readAll') && !canRun(user)) throw forbidden()
  if (!isOid(id)) throw notFound('Schedule')
  const p = await CarePlan.findById(id).lean<any>()
  if (!p || !p.pattern?.kind) throw notFound('Schedule')
  const [patient, visits, team] = await Promise.all([
    Patient.findById(p.patientId).select('name ageYears gender phone address.area').lean<any>(),
    HomecareRequest.find({ carePlanId: p._id, deletedAt: null }).select('requestNo status scheduledAt assignment.primaryStaffId').sort({ scheduledAt: 1 }).lean<any[]>(),
    User.find({ _id: { $in: [p.team?.primaryStaffId, ...(p.team?.secondaryStaffIds ?? [])].filter(Boolean) } }).select('name').lean<any[]>(),
  ])
  const today = isoDay()
  const covered = new Set(visits.map((v) => (v.scheduledAt ? isoDay(v.scheduledAt) : '')))
  const upcoming = p.status === 'ACTIVE' ? scheduleDates(ruleOf(p), today, addDays(today, 60)).filter((d) => !covered.has(d)).slice(0, 12) : []
  return {
    id: String(p._id),
    title: p.title as string,
    status: p.status as string,
    rule: describeSchedule(p.pattern, p.end),
    pattern: p.pattern,
    end: p.end,
    time: p.time as string,
    services: (p.services ?? []).map((s: any) => s.name),
    patient: patient ? { id: String(patient._id), name: patient.name, area: patient.address?.area ?? null } : null,
    team: team.map((u) => u.name),
    car: p.car ?? null,
    skipDates: p.skipDates ?? [],
    visits: visits.map((v) => ({ id: String(v._id), requestNo: v.requestNo, status: v.status, at: v.scheduledAt ? new Date(v.scheduledAt).toISOString() : null })),
    upcoming,
  }
}
