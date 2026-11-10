import 'server-only'
import { z } from 'zod'
import {
  AssignmentLog,
  Counter,
  HomecareRequest,
  Patient,
  ServiceType,
  User,
  Designation,
  Vehicle,
  Approval,
  ChatMessage,
  isOid,
} from '../models'
import { ApiError, bad, conflict, forbidden, notFound } from '../api'
import { audit } from '../audit'
import { can, FIELD_ROLES, TRANSITIONS, VITALS, type Status, hasRole, hasAnyRole } from '../constants'
import { background, getTemplate, notifyRoles, notifySet, notifyUsers, picked, queueEmail, renderTemplate, waNumber, type NotifyOnly } from '../messaging'
import { canQueue } from '../wa/status'
import { getSettings, ruleAllows } from '../settings'
import { date as fmtDate, dhakaDate, isoDay, time as fmtTime, minutesBetween, dayRange, clock } from '../format'
import type { SessionUser } from '../auth'
import { closeOpenReturns, startOut, startReturn, stopTracking } from './tracking'
import { shortLink } from '../links'
import { TestItemInput, testNames, testsTotal } from '../schemas'

type Meta = { ip?: string; userAgent?: string; client?: string }
const url = (id: unknown) => `/requests/${id}`
const appUrl = (id: unknown) => `/m/visits/${id}`

// ============================================================== numbering
export async function nextRequestNo(at = new Date()) {
  const ymd = isoDay(at).replace(/-/g, '').slice(2) // 260924
  const key = `HC-${ymd}`
  const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true })
  return `${key}-${String(c.seq).padStart(4, '0')}`
}

// ============================================================== access
export function isTeamMember(user: SessionUser, r: any) {
  const ids = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean).map(String)
  return ids.includes(user.id)
}

export function canView(user: SessionUser, r: any) {
  if (can(user, 'requests.readAll')) return true
  if (isTeamMember(user, r)) return true
  if (String(r.createdBy) === user.id) return true
  if (hasRole(user, 'DRIVER') && String(r.transport?.driverId) === user.id) return true
  if (hasRole(user, 'TRANSPORT_SUPERVISOR') && r.transport?.needed) return true
  return false
}

export async function loadRequest(id: string, user: SessionUser) {
  if (!isOid(id)) throw notFound('Request')
  const r = await HomecareRequest.findOne({ _id: id, deletedAt: null })
  if (!r) throw notFound('Request')
  if (!canView(user, r)) throw forbidden('You can only open visits assigned to you')
  return r
}

/** May do the care team's steps for them: override users always; coordinators when outside staff (no app) are on the team. */
export function actsForTeam(user: SessionUser, r: any) {
  return can(user, 'requests.override') || (!!r.assignment?.hasExternal && can(user, 'requests.assign'))
}

/** Someone acting for the team (not a member themselves): override access, or a coordinator for outside staff. */
export function onBehalf(user: SessionUser, r: any) {
  return !isTeamMember(user, r) && actsForTeam(user, r)
}

/** The care team — or someone acting for them (each such step gets an extra "on behalf" audit row). */
function requireTeam(user: SessionUser, r: any) {
  if (isTeamMember(user, r)) return
  if (!actsForTeam(user, r)) throw forbidden('Only the assigned care team can do this')
  const staffId = r.assignment?.primaryStaffId
  background(async () => {
    const staff = staffId ? await User.findById(staffId).select('name').lean<any>() : null
    await audit(user, 'request.on_behalf', 'request', r._id, { after: { status: r.status, for: staff?.name ?? 'care team' }, label: r.requestNo })
  })
}

// ============================================================== state machine
function move(r: any, to: Status, stampKey?: string, at = new Date()) {
  const from = r.status as Status
  if (from !== to && !TRANSITIONS[from]?.includes(to)) {
    throw conflict('INVALID_TRANSITION', `Cannot move from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}`)
  }
  r.status = to
  if (stampKey) r.set(`timeline.${stampKey}`, at)
  r.version = (r.version ?? 0) + 1
  return from
}

function deviceStamp(r: any, user: SessionUser, event: string, deviceAt?: string | null, offline?: boolean) {
  if (deviceAt) r.deviceStamps.push({ event, deviceAt: new Date(deviceAt), offline: !!offline, by: user.id })
}

// ============================================================== template variables
export async function templateVars(r: any, staffId?: unknown) {
  const s = await getSettings()
  const staff = staffId ? await User.findById(staffId).select('name designationId').lean<any>() : null
  const desig = staff?.designationId ? await Designation.findById(staff.designationId).select('title').lean<any>() : null
  // the share token is select:false, so requests loaded for a message button arrive without it
  let token = r.tracking?.shareToken as string | undefined
  if (!token && r.tracking?.active && r._id) token = (await HomecareRequest.findById(r._id).select('+tracking.shareToken').lean<any>())?.tracking?.shareToken
  // short links (/s/…) with a proper preview card instead of long app URLs
  const [feedbackLink, requestLink, trackLink] = r._id
    ? await Promise.all([
        shortLink(`/feedback/${r._id}`, { kind: 'FEEDBACK', requestId: r._id, ttlDays: 120 }),
        shortLink(`/requests/${r._id}`, { kind: 'REQUEST', requestId: r._id }),
        token ? shortLink(`/t/${token}`, { kind: 'TRACK', requestId: r._id, ttlDays: 3 }) : '',
      ])
    : ['', '', '']
  return {
    patientName: r.patientSnapshot?.name,
    requestNo: r.requestNo,
    serviceType: (r.services ?? []).map((x: any) => x.name).join(', '),
    date: r.scheduledAt ? fmtDate(r.scheduledAt) : r.preferred?.date ?? '',
    slot: clock(r.slot ?? r.preferred?.slot) || (r.scheduledAt ? fmtTime(r.scheduledAt) : ''),
    staffName: staff?.name ?? '',
    designation: desig?.title ?? '',
    address: r.patientSnapshot?.address,
    patientPhone: r.patientSnapshot?.phone,
    age: r.patientSnapshot?.ageYears,
    gender: r.patientSnapshot?.gender,
    notes: r.assignment?.instructions || r.clinical?.complaint || '',
    feedbackLink,
    hospitalPhone: s.general.hospitalPhone,
    checkInAt: fmtTime(r.timeline?.checkInAt),
    checkOutAt: fmtTime(r.timeline?.checkOutAt),
    durationMin: r.visit?.durationMin ?? '',
    doneCount: (r.visit?.checklist ?? []).filter((c: any) => c.done).length,
    totalCount: (r.visit?.checklist ?? []).length,
    priority: r.priority ? r.priority[0] + String(r.priority).slice(1).toLowerCase() : '',
    requestLink,
    trackLink,
  }
}

/** WhatsApp the heads of department of the request's service categories (Settings → Notification rules →
 *  Department heads). One message per person even when they head several of the categories. */
export async function notifyHods(r: any, only?: NotifyOnly) {
  const { hodRecipients } = await import('./hod')
  const to = (await hodRecipients(r)).filter((c) => picked(only, waNumber(c.phone)))
  if (!to.length) return
  const def = await getTemplate('hod_new_request')
  if (!(await canQueue())) return
  const { queueWhatsApp } = await import('../wa/service')
  const { renderText } = await import('../templates')
  const vars = await templateVars(r)
  for (const c of to) {
    const v = { ...vars, staffName: c.name, designation: c.designation, group: c.group.name }
    // a group's own message wins; otherwise the shared template (unless switched off in Templates)
    const text = c.group.message?.trim() ? renderText(c.group.message, v) : def.isActive === false ? null : (await renderTemplate('hod_new_request', v)).text
    if (text) await queueWhatsApp({ to: c.phone, toName: `${c.name} (${c.designation})`, text, templateKey: 'hod_new_request', requestId: r._id })
  }
}

/** Email the patient (if they have an email and consented) using a template. WhatsApp is sent from the UI via deep link. */
const PATIENT_EVENT: Record<string, string> = {
  patient_confirmed: 'CONFIRMED',
  patient_assigned: 'ASSIGNED',
  patient_rescheduled: 'RESCHEDULED',
  patient_cancelled: 'CANCELLED',
  patient_completed: 'COMPLETED',
}

export async function emailPatient(r: any, templateKey: string, user: SessionUser | null, staffId?: unknown) {
  const s = await getSettings()
  const event = PATIENT_EVENT[templateKey] ?? (templateKey === 'patient_received' ? 'REQUEST_CREATED' : undefined)
  const p = await Patient.findById(r.patientId).select('email consent name').lean<any>()
  if (!p) return
  const t = await renderTemplate(templateKey, await templateVars(r, staffId))
  if (!t.active) return
  const toPatient = s.email.sendPatientEmails && !!p.email && p.consent?.email !== false && !(event && !ruleAllows(s.notificationRules, event, 'PATIENT', 'email'))
  if (toPatient) await queueEmail({ to: p.email, toName: p.name, subject: t.subject, text: t.text, templateKey, requestId: r._id, patientId: r.patientId, initiatedBy: user?.id })
  // copies for managers / department (Settings → Notification rules → Extra email recipients)
  const copies = (event && s.emailCopies?.[event]) || []
  if (copies.length)
    await queueEmail({
      to: copies.join(','),
      subject: `[Copy] ${t.subject}`,
      text: `${t.text}\n\n— Copy of the ${toPatient ? 'message sent to' : 'message for'} ${p.name}${p.email ? ` (${p.email})` : ' (no email on file)'} · request ${r.requestNo}.`,
      templateKey,
      requestId: r._id,
      patientId: r.patientId,
      initiatedBy: user?.id,
    })
}

/** WhatsApp the patient automatically (hospital WhatsApp paired in Settings). Falls back silently: staff still have the manual wa.me button. */
/** Auto-send a template to the patient on WhatsApp. `explicit`: a coordinator ticked "send to patient" for this
 *  action, so the global auto-send switch and the notification matrix don't apply (consent and pairing still do). */
export async function whatsappPatient(r: any, templateKey: string, user: SessionUser | null, staffId?: unknown, explicit = false) {
  const s = await getSettings()
  if (!explicit && s.whatsapp.autoSend === false) return
  const event = PATIENT_EVENT[templateKey] ?? (templateKey === 'patient_received' ? 'REQUEST_CREATED' : undefined)
  if (!explicit && event && !ruleAllows(s.notificationRules, event, 'PATIENT', 'whatsapp')) return
  const p = await Patient.findById(r.patientId).select('phone whatsapp consent name').lean<any>()
  if (!p || p.consent?.whatsapp === false) return
  const def = await getTemplate(templateKey)
  if (def.isActive === false || !def.channel.includes('WHATSAPP')) return
  if (!(await canQueue())) return
  // Baileys + pino are loaded only when a message is actually sent — never on a plain page render (cold start).
  const { queueWhatsApp } = await import('../wa/service')
  const { text } = await renderTemplate(templateKey, await templateVars(r, staffId))
  await queueWhatsApp({ to: p.whatsapp || p.phone, toName: p.name, text, templateKey, requestId: r._id, patientId: r.patientId, initiatedBy: user?.id })
}

/** Patient WhatsApp for an action with a "Notify on WhatsApp" list: ticked → sent, unticked → not; no list → auto-send rules. */
async function patientWa(r: any, templateKey: string, user: SessionUser, only: NotifyOnly, staffId?: unknown) {
  if (only && !only.has('patient')) return
  await whatsappPatient(r, templateKey, user, staffId, !!only)
}

/** WhatsApp the care team members ticked in "Notify on WhatsApp" (only ever sent when a person ticked them). */
async function staffWa(r: any, staffIds: unknown[], templateKey: string, user: SessionUser, only: NotifyOnly, extra: Record<string, unknown> = {}) {
  if (!only || !staffIds.length || !(await canQueue())) return
  const def = await getTemplate(templateKey)
  if (def.isActive === false || !def.channel.includes('WHATSAPP')) return
  const people = await User.find({ _id: { $in: staffIds.filter(Boolean) } }).select('name phone whatsapp').lean<any[]>()
  const { queueWhatsApp } = await import('../wa/service')
  for (const u of people) {
    const phone = u.whatsapp || u.phone
    if (!waNumber(phone) || !only.has(waNumber(phone))) continue
    const { text } = await renderTemplate(templateKey, { ...(await templateVars(r, u._id)), ...extra })
    await queueWhatsApp({ to: phone, toName: `${u.name} (care team)`, text, templateKey, requestId: r._id, initiatedBy: user.id })
  }
}

/** Keep the "Notify on WhatsApp" choice (ticked + left out) for the request's Notified tab — before anything is sent. */
async function logDecision(r: any, events: import('./notify').NotifyEvent[], only: NotifyOnly, user: SessionUser, extra: Partial<import('./notify').NotifyPreviewInput> = {}) {
  if (!only) return
  const { recordNotifyDecision } = await import('./notify-log')
  await recordNotifyDecision(r, events, only, user.id, extra)
}

/** "Notify on WhatsApp" list sent with an action: 'patient' + WhatsApp numbers. Unset = the Settings defaults. */
export const NotifyField = z.array(z.string().max(32)).max(80).optional()

/** Start time of a slot label: "09:30–10:30" → "09:30"; legacy "09–11" → "09:00"; none → "09:00". */
export function slotStart(slot?: string) {
  if (slot && /^\d{2}:\d{2}/.test(slot)) return slot.slice(0, 5)
  return `${slot?.match(/^\d{1,2}/)?.[0]?.padStart(2, '0') ?? '09'}:00`
}

/** Car paperwork (lib/services/transport-docs.ts), loaded only when needed — sent once the care team is assigned.
 *  A first request also alerts the Security / Transport groups ("Car requested"). */
export async function carRequestedLazy(requestId: unknown, userId: string, opts: { updated?: boolean; only?: NotifyOnly } = {}) {
  const { carRequested } = await import('./transport-docs')
  const first = await carRequested(requestId, userId, opts)
  if (first && !opts.updated) await carAlertLazy('CAR_REQUESTED', requestId, {}, opts.only)
}

/** Security / Transport group alert (lib/services/hod.ts carAlert), never throws. */
export async function carAlertLazy(event: import('./hod').CarEvent, requestId: unknown, extra: { reason?: string; at?: Date } = {}, only?: NotifyOnly) {
  try {
    const { carAlert } = await import('./hod')
    await carAlert(event, requestId, extra, only)
  } catch (e) {
    console.error('[car alert]', event, e)
  }
}

/** "Live updates" group alert for a visit step (lib/services/hod.ts visitAlert), never throws. */
export async function visitAlertLazy(event: import('../constants').VisitEvent, requestId: unknown, extra: import('./hod').VisitAlertExtra = {}, only?: NotifyOnly) {
  const { visitAlert } = await import('./hod')
  await visitAlert(event, requestId, extra, only)
}

/** A Unico car (or not decided yet) — the requisition goes to the security supervisor once the team is assigned. */
const wantsUnicoCar = (r: any) => !!r.transport?.needed && (!r.transport.mode || r.transport.mode === 'UNICO_CAR')

// ============================================================== create
export const CreateRequestInput = z.object({
  patientId: z.string().optional(),
  patient: z
    .object({
      name: z.string().min(2),
      phone: z.string().min(6),
      altPhone: z.string().optional(),
      ageYears: z.coerce.number().int().min(0).max(120).optional(),
      gender: z.enum(['M', 'F', 'O']).optional(),
      uhid: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      bloodGroup: z.string().optional(),
      address: z.object({ area: z.string().optional(), full: z.string().min(3), house: z.string().optional(), flat: z.string().optional(), landmark: z.string().optional(), lat: z.number().optional(), lng: z.number().optional() }),
    })
    .optional(),
  requester: z.object({ type: z.enum(['SELF', 'RELATIVE', 'STAFF']).default('SELF'), name: z.string().optional(), relation: z.string().optional(), phone: z.string().optional() }).optional(),
  serviceCodes: z.array(z.string()).default([]),
  otherService: z.string().optional(),
  tests: z.array(z.string()).default([]),
  testItems: z.array(TestItemInput).max(60).optional(), // H360 catalog picks with code + price
  priority: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).default('ROUTINE'),
  preferredDate: z.string().optional(), // YYYY-MM-DD
  preferredTime: z.string().optional(), // HH:mm
  preferredSlot: z.string().optional(),
  expectedDurationMin: z.coerce.number().int().positive().optional(),
  complaint: z.string().optional(),
  clinicalNotes: z.string().optional(),
  referringDoctor: z.string().optional(),
  allergies: z.array(z.string()).optional(),
  estimatedFee: z.coerce.number().nonnegative().optional(),
  paymentMethod: z.enum(['CASH', 'BKASH', 'NAGAD', 'CARD']).optional(),
  transportNeeded: z.boolean().optional(),
  source: z.enum(['PHONE', 'WALK_IN', 'WHATSAPP', 'WEBSITE', 'APP']).optional(),
  remarks: z.string().optional(),
  carePlanId: z.string().optional(),
  ignoreDuplicate: z.boolean().optional(),
  /** one save: create, then confirm (and assign the care team) — see createAndAssign */
  then: z.enum(['confirm', 'assign']).optional(),
  assign: z.object({ primaryStaffId: z.string(), secondaryStaffIds: z.array(z.string()).default([]), instructions: z.string().optional(), acceptNow: z.boolean().optional() }).optional(),
  notify: NotifyField,
})
export type CreateRequestInput = z.infer<typeof CreateRequestInput>

export async function buildChecklist(serviceTypeIds: unknown[]) {
  const types = await ServiceType.find({ _id: { $in: serviceTypeIds } }).lean<any[]>()
  const seen = new Set<string>()
  const list: any[] = []
  for (const t of types)
    for (const c of [...(t.checklist ?? [])].sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      if (seen.has(c.key)) continue
      seen.add(c.key)
      list.push({ key: c.key, label: c.label, mandatory: c.mandatory !== false, done: false })
    }
  return list
}

export async function createRequest(input: CreateRequestInput, user: SessionUser, meta: Meta = {}) {
  if (!can(user, 'requests.create')) throw forbidden()
  let patient: any
  if (input.patientId) {
    if (!isOid(input.patientId)) throw bad('Invalid patient')
    patient = await Patient.findById(input.patientId)
    if (!patient) throw notFound('Patient')
  } else if (input.patient) {
    const p = input.patient
    patient = await Patient.findOne({ phone: p.phone, name: p.name, deletedAt: null })
    if (!patient) {
      patient = await Patient.create({
        name: p.name,
        phone: p.phone,
        altPhone: p.altPhone,
        ageYears: p.ageYears,
        gender: p.gender,
        uhid: p.uhid || undefined,
        email: p.email || undefined,
        bloodGroup: p.bloodGroup,
        address: { ...p.address, district: 'Dhaka' },
        addressHistory: [{ full: p.address.full, area: p.address.area, from: new Date() }],
        source: input.source ?? 'PHONE',
        createdBy: user.id,
      })
      await audit(user, 'patient.create', 'patient', patient._id, { after: { name: p.name, phone: p.phone }, label: p.name }, meta)
    }
  } else throw bad('Choose an existing patient or enter new patient details')

  const types = await ServiceType.find({ code: { $in: input.serviceCodes } }).lean<any[]>()
  const services = types.map((t) => ({ serviceTypeId: t._id, code: t.code, name: t.name }))
  if (input.otherService) services.push({ serviceTypeId: undefined, code: 'OTHER', name: input.otherService })
  if (!services.length) throw bad('Pick at least one service', { serviceCodes: 'Required' })

  // Duplicate guard: same phone + service within the same preferred day, created < 2 h ago
  if (!input.ignoreDuplicate) {
    const dupe = await HomecareRequest.findOne({
      'patientSnapshot.phone': patient.phone,
      'services.code': { $in: services.map((s) => s.code) },
      status: { $nin: ['CANCELLED', 'CLOSED'] },
      createdAt: { $gte: new Date(Date.now() - 2 * 3600_000) },
    })
      .select('requestNo')
      .lean<any>()
    if (dupe) throw new ApiError(409, 'DUPLICATE', `Possible duplicate of ${dupe.requestNo} (same phone and service in the last 2 hours)`, { requestNo: dupe.requestNo })
  }

  const scheduledAt = input.preferredDate ? dhakaDate(input.preferredDate, input.preferredTime || slotStart(input.preferredSlot)) : undefined
  const duration = input.expectedDurationMin ?? Math.max(...types.map((t) => t.defaultDurationMin ?? 45), 30)
  const now = new Date()
  const r = await HomecareRequest.create({
    requestNo: await nextRequestNo(now),
    patientId: patient._id,
    patientSnapshot: {
      name: patient.name,
      phone: patient.phone,
      ageYears: patient.ageYears,
      gender: patient.gender,
      uhid: patient.uhid,
      area: patient.address?.area,
      address: [patient.address?.full, patient.address?.area].filter(Boolean).join(', '),
      photoUrl: patient.photoUrl,
    },
    requester: input.requester ?? (hasAnyRole(user, FIELD_ROLES) ? { type: 'STAFF', name: user.name } : { type: 'SELF' }),
    services,
    tests: testNames(input.testItems, input.tests),
    testItems: input.testItems ?? [],
    priority: input.priority,
    preferred: { date: input.preferredDate, slot: input.preferredSlot, time: input.preferredTime },
    scheduledAt,
    slot: input.preferredSlot,
    expectedDurationMin: duration,
    clinical: { complaint: input.complaint, notes: input.clinicalNotes, referringDoctor: input.referringDoctor, allergies: input.allergies ?? patient.allergies },
    timeline: { requestedAt: now },
    visit: {
      checklist: await buildChecklist(types.map((t) => t._id)),
      afterSet: true,
      afterChecklist: await (await import('./after-checklist')).buildAfterChecklist(types.map((t) => t._id)),
      kitSet: true,
      kit: await (await import('./kit')).buildKit(types.map((t) => t._id)),
    },
    transport: { needed: !!input.transportNeeded, status: input.transportNeeded ? 'REQUESTED' : undefined },
    billing: { estimatedFee: input.estimatedFee ?? types.reduce((a, t) => a + (t.fee ?? 0), 0) + testsTotal(input.testItems), method: input.paymentMethod },
    source: input.source ?? (user.client === 'app' ? 'APP' : 'PHONE'),
    remarks: input.remarks,
    carePlanId: input.carePlanId && isOid(input.carePlanId) ? input.carePlanId : undefined,
    createdBy: user.id,
  })
  await audit(user, 'request.create', 'request', r._id, { after: { requestNo: r.requestNo, patient: patient.name, services: services.map((s) => s.name), priority: r.priority }, label: r.requestNo }, meta)
  // heads of department hear about every new request except visits generated from a care plan.
  // No car requisition yet: it goes to the security supervisor once the care team is assigned (assign below).
  if (!r.carePlanId)
    background(async () => {
      const only = notifySet(input.notify)
      await logDecision(r, ['NEW_REQUEST'], only, user)
      await notifyHods(r, only)
    })
  // full profile from H360 (category, DOB, religion, emergency contact…) for patients with a UHID
  if (patient.uhid) background(async () => (await import('../h360-patient')).syncPatientQuietly(patient._id))
  background(() =>
    notifyRoles(
      ['HC_ADMIN'],
      {
        type: 'REQUEST_CREATED',
        title: `${r.priority === 'ROUTINE' ? 'New request' : `${r.priority} request`} ${r.requestNo}`,
        body: `${patient.name} · ${services.map((s) => s.name).join(', ')} · by ${user.name}`,
        requestId: r._id,
        url: url(r._id),
        priority: r.priority === 'ROUTINE' ? 'normal' : 'high',
      },
      user.id,
    ),
  )
  return r
}

/**
 * New request → "Save & confirm" / "Save & assign" in one call: create, confirm and (optionally) assign the care team.
 * Each step keeps its own audit row; permissions and the team are checked first so nothing is left half done.
 */
export async function createAndAssign(input: CreateRequestInput, user: SessionUser, meta: Meta = {}) {
  if (!input.then) return createRequest(input, user, meta)
  if (!can(user, 'requests.manage')) throw forbidden('You can save the request, but not confirm it')
  const team = input.then === 'assign' ? input.assign : undefined
  if (input.then === 'assign' && !team) throw bad('Pick the lead staff member', { primaryStaffId: 'Required' })
  if (team) {
    if (!can(user, 'requests.assign')) throw forbidden('You can save the request, but not assign staff')
    const ids = [team.primaryStaffId, ...team.secondaryStaffIds]
    if (!ids.every(isOid) || new Set(ids).size !== ids.length) throw bad('Check the care team', { primaryStaffId: 'Invalid or duplicate team member' })
    if ((await User.countDocuments({ _id: { $in: ids }, status: 'ACTIVE' })) !== ids.length) throw bad('One or more staff members are not active')
  }
  if (!input.preferredDate) throw bad('Set the date of service to confirm', { preferredDate: 'Required' })
  const created = await createRequest(input, user, meta)
  const r = await HomecareRequest.findById(created._id)
  const when = { date: input.preferredDate, time: input.preferredTime, slot: input.preferredSlot }
  await confirm(r, { ...when, notify: input.notify }, user, meta, { quiet: !!team })
  if (team) await assign(r, { ...team, notify: input.notify }, user, meta)
  return r
}

// ============================================================== coordinator actions
export async function verify(r: any, user: SessionUser, meta: Meta) {
  move(r, 'VERIFIED', 'verifiedAt')
  await r.save()
  await audit(user, 'request.verify', 'request', r._id, { after: { status: 'VERIFIED' }, label: r.requestNo }, meta)
}

export const ConfirmInput = z.object({
  date: z.string().optional(), // YYYY-MM-DD
  time: z.string().optional(), // HH:mm
  slot: z.string().optional(),
  uhid: z.string().optional(),
  tests: z.array(z.string()).optional(),
  testItems: z.array(TestItemInput).max(60).optional(),
  estimatedFee: z.coerce.number().nonnegative().optional(),
  paymentMethod: z.enum(['CASH', 'BKASH', 'NAGAD', 'CARD']).optional(),
  transportNeeded: z.boolean().optional(),
  priority: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).optional(),
  expectedDurationMin: z.coerce.number().int().positive().optional(),
  /** true: the coordinator ticked "send confirmation to the patient" (sent even if auto-send rules are off);
   *  false: don't message the patient; omitted: the usual auto-send rules decide. Superseded by `notify`. */
  notifyPatient: z.boolean().optional(),
  notify: NotifyField,
})

/** `quiet`: an assignment follows at once (New request → Save & assign), so its messages say it all. */
export async function confirm(r: any, input: z.infer<typeof ConfirmInput>, user: SessionUser, meta: Meta, opts: { quiet?: boolean } = {}) {
  const before = { status: r.status, scheduledAt: r.scheduledAt, tests: r.tests, uhid: r.patientSnapshot?.uhid }
  move(r, 'CONFIRMED', 'confirmedAt')
  if (input.date) r.scheduledAt = dhakaDate(input.date, input.time || slotStart(input.slot))
  if (input.slot) r.slot = input.slot
  if (input.testItems) {
    r.testItems = input.testItems
    r.tests = testNames(input.testItems, input.tests ?? [])
  } else if (input.tests) r.tests = input.tests
  if (input.priority) r.priority = input.priority
  if (input.expectedDurationMin) r.expectedDurationMin = input.expectedDurationMin
  if (input.estimatedFee != null) r.set('billing.estimatedFee', input.estimatedFee)
  if (input.paymentMethod) r.set('billing.method', input.paymentMethod)
  if (input.transportNeeded != null) {
    r.set('transport.needed', input.transportNeeded)
    if (input.transportNeeded && !r.transport?.status) r.set('transport.status', 'REQUESTED')
  }
  if (input.uhid) {
    r.set('patientSnapshot.uhid', input.uhid)
    await Patient.updateOne({ _id: r.patientId }, { uhid: input.uhid })
  }
  if (!r.scheduledAt) throw bad('Set the date and time of service before confirming')
  await r.save()
  const only = notifySet(input.notify)
  await audit(user, 'request.confirm', 'request', r._id, { before, after: { status: 'CONFIRMED', scheduledAt: r.scheduledAt, tests: r.tests, uhid: input.uhid, ...(only && { whatsappTo: [...only] }) }, label: r.requestNo }, meta)
  background(async () => {
    if (!opts.quiet) await logDecision(r, ['CONFIRMED'], only, user)
    if (!opts.quiet && input.notifyPatient !== false) {
      await emailPatient(r, 'patient_confirmed', user)
      if (only) await patientWa(r, 'patient_confirmed', user, only)
      else await whatsappPatient(r, 'patient_confirmed', user, undefined, input.notifyPatient === true)
    }
    await notifyRoles(['FRONT_DESK'], { type: 'CONFIRMED', title: `${r.requestNo} confirmed`, body: `${r.patientSnapshot.name} · ${fmtDate(r.scheduledAt)} ${fmtTime(r.scheduledAt)}`, requestId: r._id, url: url(r._id) })
    if (!opts.quiet) await visitAlertLazy('CONFIRMED', r._id, { by: user.name }, only)
    // the car requisition and the trip ping wait for the care team (assign), so the form names who travels
  })
}

export const AssignInput = z.object({
  primaryStaffId: z.string(),
  secondaryStaffIds: z.array(z.string()).default([]),
  teamSize: z.coerce.number().int().min(1).max(10).optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  slot: z.string().optional(),
  expectedDurationMin: z.coerce.number().int().positive().optional(),
  instructions: z.string().optional(),
  fee: z.coerce.number().nonnegative().optional(),
  /** override: put the team on the visit as already accepted — no waiting for the staff to tap Accept */
  acceptNow: z.boolean().optional(),
  notify: NotifyField,
})

export async function assign(r: any, input: z.infer<typeof AssignInput>, user: SessionUser, meta: Meta) {
  const ids = [input.primaryStaffId, ...input.secondaryStaffIds]
  if (!ids.every(isOid)) throw bad('Invalid staff')
  if (new Set(ids).size !== ids.length) throw bad('The same person is on the care team twice', { secondaryStaffIds: 'Duplicate team member' })
  const staff = await User.find({ _id: { $in: ids }, status: 'ACTIVE' }).select('name role availability external').lean<any[]>()
  if (staff.length !== new Set(ids).size) throw bad('One or more staff members are not active')
  const prevPrimary = r.assignment?.primaryStaffId ? String(r.assignment.primaryStaffId) : null
  const isReassign = ['ASSIGNED', 'ACCEPTED'].includes(r.status)
  if (r.status === 'ACCEPTED' || r.status === 'ASSIGNED') r.status = 'CONFIRMED' // re-assign resets acceptance
  if (r.status === 'RESCHEDULED') move(r, 'CONFIRMED', 'confirmedAt') // the new time was agreed: confirm, then assign
  move(r, 'ASSIGNED', 'assignedAt')
  const s = await getSettings()
  if (input.date) r.scheduledAt = dhakaDate(input.date, input.time || slotStart(input.slot))
  if (input.slot) r.slot = input.slot
  if (input.expectedDurationMin) r.expectedDurationMin = input.expectedDurationMin
  if (input.fee != null) r.set('billing.estimatedFee', input.fee)
  r.set('assignment.primaryStaffId', input.primaryStaffId)
  r.set('assignment.secondaryStaffIds', input.secondaryStaffIds)
  r.set('assignment.teamSize', input.teamSize ?? ids.length)
  r.set('assignment.assignedBy', user.id)
  r.set('assignment.assignedAt', new Date())
  r.set('assignment.acceptedAt', undefined)
  r.set('assignment.respondBy', new Date(Date.now() + s.sla.acceptTimeoutMin * 60_000))
  r.set('assignment.timedOutAt', undefined)
  r.set('assignment.instructions', input.instructions)
  r.set('assignment.hasExternal', staff.some((x) => x.external))
  const forced = !!input.acceptNow && actsForTeam(user, r)
  if (forced) {
    move(r, 'ACCEPTED', 'acceptedAt')
    r.set('assignment.acceptedAt', new Date())
    r.set('assignment.respondBy', undefined)
  }
  await r.save()
  await AssignmentLog.create({ requestId: r._id, fromStaffId: prevPrimary ?? undefined, toStaffId: input.primaryStaffId, action: isReassign ? 'REASSIGN' : 'ASSIGN', by: user.id, reason: input.instructions })
  if (forced) {
    await AssignmentLog.create({ requestId: r._id, toStaffId: input.primaryStaffId, action: 'ACCEPT_BY_OVERRIDE', by: user.id, reason: 'Assigned and accepted by coordinator' })
    await audit(user, 'request.accept_override', 'request', r._id, { after: { status: 'ACCEPTED', for: staff.find((x) => String(x._id) === input.primaryStaffId)?.name }, label: r.requestNo }, meta)
  }
  const only = notifySet(input.notify)
  await audit(user, isReassign ? 'request.reassign' : 'request.assign', 'request', r._id, { before: { primaryStaffId: prevPrimary }, after: { team: staff.map((x) => x.name), scheduledAt: r.scheduledAt, ...(only && { whatsappTo: [...only] }) }, label: r.requestNo }, meta)
  background(async () => {
    await logDecision(r, ['ASSIGNED'], only, user, { staffIds: ids })
    const when = `${fmtDate(r.scheduledAt)} ${fmtTime(r.scheduledAt)}`
    await notifyUsers([input.primaryStaffId], {
      type: 'ASSIGNED',
      title: forced ? `New visit ${r.requestNo} · assigned & accepted for you by ${user.name}` : `New visit ${r.requestNo} · respond in ${s.sla.acceptTimeoutMin} min`,
      body: `${r.patientSnapshot.name} · ${r.services.map((x: any) => x.name).join(', ')} · ${when} · ${r.patientSnapshot.area ?? ''}`,
      requestId: r._id,
      url: appUrl(r._id),
      priority: 'high',
    })
    await notifyUsers(input.secondaryStaffIds, { type: 'ASSIGNED', as: 'STAFF', title: `Added to care team ${r.requestNo}`, body: `${r.patientSnapshot.name} · ${when}`, requestId: r._id, url: appUrl(r._id) })
    if (prevPrimary && prevPrimary !== input.primaryStaffId) await notifyUsers([prevPrimary], { type: 'CANCELLED', as: 'STAFF', title: `${r.requestNo} reassigned`, body: 'This visit was given to another staff member', requestId: r._id })
    await visitAlertLazy('ASSIGNED', r._id, { by: user.name }, only)
    if (forced) await visitAlertLazy('ACCEPTED', r._id, { by: user.name, onBehalf: true, staffName: staff.find((x) => String(x._id) === input.primaryStaffId)?.name }, only)
    await emailPatient(r, 'patient_assigned', user, input.primaryStaffId)
    await patientWa(r, 'patient_assigned', user, only, input.primaryStaffId)
    await staffWa(r, ids, 'staff_assigned', user, only)
    // Unico car: the requisition now names the assigned team (an "UPDATED" one after a reassignment)
    if (wantsUnicoCar(r)) {
      await carRequestedLazy(r._id, user.id, { updated: !!r.transport?.requisitionSentAt, only })
      await notifyRoles(['TRANSPORT_SUPERVISOR'], { type: 'TRANSPORT', title: `Trip request ${r.requestNo}`, body: `${r.patientSnapshot.area ?? ''} · ${fmtDate(r.scheduledAt)} ${fmtTime(r.scheduledAt)} · ${staff.map((x) => x.name).join(', ')}`, requestId: r._id, url: '/m/trips' })
    }
  })
}

export const RescheduleInput = z.object({ date: z.string(), time: z.string().optional(), slot: z.string().optional(), reason: z.string().min(2), notify: NotifyField })
export async function reschedule(r: any, input: z.infer<typeof RescheduleInput>, user: SessionUser, meta: Meta) {
  const from = r.scheduledAt
  move(r, 'RESCHEDULED', 'rescheduledAt')
  r.scheduledAt = dhakaDate(input.date, input.time || slotStart(input.slot))
  if (input.slot) r.slot = input.slot
  r.reschedules.push({ from, to: r.scheduledAt, slot: input.slot, reason: input.reason, by: user.id, at: new Date() })
  // re-confirm immediately: the coordinator made the decision with the patient
  move(r, 'CONFIRMED', 'confirmedAt')
  const team = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean)
  r.set('assignment.primaryStaffId', undefined)
  r.set('assignment.secondaryStaffIds', [])
  await r.save()
  const only = notifySet(input.notify)
  await audit(user, 'request.reschedule', 'request', r._id, { before: { scheduledAt: from }, after: { scheduledAt: r.scheduledAt, reason: input.reason, ...(only && { whatsappTo: [...only] }) }, label: r.requestNo }, meta)
  background(async () => {
    await logDecision(r, ['RESCHEDULED'], only, user, { staffIds: team.map(String) })
    await notifyUsers(team, { type: 'RESCHEDULED', as: 'STAFF', title: `${r.requestNo} rescheduled`, body: `New time ${fmtDate(r.scheduledAt)} ${fmtTime(r.scheduledAt)} · needs re-assignment`, requestId: r._id, url: appUrl(r._id) })
    await emailPatient(r, 'patient_rescheduled', user)
    await patientWa(r, 'patient_rescheduled', user, only)
    await staffWa(r, team, 'staff_rescheduled', user, only, { reason: input.reason })
    await visitAlertLazy('RESCHEDULED', r._id, { by: user.name, reason: input.reason }, only)
    // the team is cleared: the updated requisition goes to the security supervisor with the next assignment
    if (r.transport?.needed) await carAlertLazy('CAR_CHANGED', r._id, {}, only)
  })
}

export const CancelInput = z.object({ reason: z.string().min(2), notify: NotifyField })
export async function cancel(r: any, input: z.infer<typeof CancelInput>, user: SessionUser, meta: Meta) {
  const from = move(r, 'CANCELLED', 'cancelledAt')
  r.cancellation = { reason: input.reason, by: user.id, at: new Date() }
  stopTracking(r)
  await r.save()
  const only = notifySet(input.notify)
  await audit(user, 'request.cancel', 'request', r._id, { before: { status: from }, after: { status: 'CANCELLED', reason: input.reason, ...(only && { whatsappTo: [...only] }) }, label: r.requestNo }, meta)
  background(async () => {
    await logDecision(r, ['CANCELLED'], only, user)
    await notifyUsers([r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? []), r.transport?.driverId], { type: 'CANCELLED', as: 'STAFF', title: `${r.requestNo} cancelled`, body: input.reason, requestId: r._id })
    await emailPatient(r, 'patient_cancelled', user)
    await patientWa(r, 'patient_cancelled', user, only)
    await staffWa(r, [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? []), r.transport?.driverId], 'staff_cancelled', user, only, { reason: input.reason })
    await visitAlertLazy('CANCELLED', r._id, { by: user.name, reason: input.reason }, only)
    if (r.transport?.needed) await carAlertLazy('CAR_CANCELLED', r._id, { reason: input.reason }, only)
  })
}

export const CloseInput = z.object({
  invoiceNo: z.string().min(1),
  invoiceAmount: z.coerce.number().nonnegative(),
  invoicePrinted: z.boolean(),
  billAmount: z.coerce.number().nonnegative().optional(),
  billingStatus: z.enum(['PAID', 'DUE', 'WAIVED']).optional(),
})
export async function close(r: any, input: z.infer<typeof CloseInput>, user: SessionUser, meta: Meta) {
  if (r.pettyCash?.some((p: any) => p.status === 'PENDING')) throw bad('Approve or reject the pending petty cash request first')
  // after-return items marked required (Settings → Services) must be done first, e.g. samples handed to the lab
  const after = await import('./after-checklist')
  await after.ensureAfterChecklist(r)
  const open = after.openRequiredAfter(r)
  if (open.length) throw new ApiError(409, 'AFTER_RETURN_OPEN', `Finish the after-return items first: ${open.map((c: any) => c.label).join(', ')}`)
  move(r, 'CLOSED', 'closedAt')
  r.set('billing.invoiceNo', input.invoiceNo)
  r.set('billing.invoiceAmount', input.invoiceAmount)
  r.set('billing.invoicePrinted', input.invoicePrinted)
  if (input.billAmount != null) r.set('billing.billAmount', input.billAmount)
  if (input.billingStatus) r.set('billing.status', input.billingStatus)
  r.set('billing.reconciledBy', user.id)
  r.set('billing.reconciledAt', new Date())
  await r.save()
  if (r.billing?.status === 'DUE') await Patient.updateOne({ _id: r.patientId }, { $inc: { balance: r.billing.billAmount ?? 0 } })
  await audit(user, 'request.close', 'request', r._id, { after: { status: 'CLOSED', invoiceNo: input.invoiceNo, invoiceAmount: input.invoiceAmount, invoicePrinted: input.invoicePrinted }, label: r.requestNo }, meta)
}

/** Invoice fields can be added by the front desk while the visit is still COMPLETED (before closing). */
export async function saveInvoice(r: any, input: Partial<z.infer<typeof CloseInput>>, user: SessionUser, meta: Meta) {
  if (!can(user, 'billing.invoice')) throw forbidden()
  for (const k of ['invoiceNo', 'invoiceAmount', 'invoicePrinted', 'billAmount'] as const) if (input[k] != null) r.set(`billing.${k}`, input[k])
  if (input.billingStatus) r.set('billing.status', input.billingStatus)
  await r.save()
  await audit(user, 'request.invoice', 'request', r._id, { after: input, label: r.requestNo }, meta)
}

// ============================================================== staff actions
export async function accept(r: any, user: SessionUser, meta: Meta, deviceAt?: string) {
  const forced = onBehalf(user, r)
  if (!forced && String(r.assignment?.primaryStaffId) !== user.id && !isTeamMember(user, r)) throw forbidden('This visit is not assigned to you')
  if (r.status === 'ACCEPTED') return
  if (forced && !r.assignment?.primaryStaffId) throw conflict('NO_TEAM', 'Assign staff first')
  move(r, 'ACCEPTED', 'acceptedAt')
  r.set('assignment.acceptedAt', new Date())
  r.set('assignment.respondBy', undefined)
  r.set('assignment.timedOutAt', undefined)
  if (!forced) deviceStamp(r, user, 'accept', deviceAt)
  await r.save()
  if (forced) {
    const staff = await User.findById(r.assignment.primaryStaffId).select('name').lean<any>()
    await AssignmentLog.create({ requestId: r._id, toStaffId: r.assignment.primaryStaffId, action: 'ACCEPT_BY_OVERRIDE', by: user.id, reason: `Accepted by ${user.name} for ${staff?.name ?? 'staff'}` })
    await audit(user, 'request.accept_override', 'request', r._id, { after: { status: 'ACCEPTED', for: staff?.name }, label: r.requestNo }, meta)
    background(async () => {
      await notifyUsers([r.assignment.primaryStaffId, ...(r.assignment.secondaryStaffIds ?? [])], { type: 'ACCEPTED', as: 'STAFF', title: `${r.requestNo} accepted for you by ${user.name}`, body: `${r.patientSnapshot.name} · ${fmtDate(r.scheduledAt)} ${fmtTime(r.scheduledAt)}`, requestId: r._id, url: appUrl(r._id), priority: 'high' })
      await visitAlertLazy('ACCEPTED', r._id, { by: user.name, onBehalf: true, staffName: staff?.name })
    })
    return
  }
  await AssignmentLog.create({ requestId: r._id, toStaffId: user.id, action: 'ACCEPT', by: user.id })
  await audit(user, 'request.accept', 'request', r._id, { after: { status: 'ACCEPTED' }, label: r.requestNo }, meta)
  background(async () => {
    await notifyRoles(['HC_ADMIN'], { type: 'ACCEPTED', title: `${r.requestNo} accepted`, body: `${user.name} accepted · ${r.patientSnapshot.name}`, requestId: r._id, url: url(r._id) })
    await visitAlertLazy('ACCEPTED', r._id, { staffName: user.name })
  })
}

/** The acceptance window passed: give the staff another window instead of reassigning (coordinator's choice). */
export async function keepWaiting(r: any, user: SessionUser, meta: Meta) {
  if (r.status !== 'ASSIGNED') throw conflict('NOT_WAITING', 'This visit is not waiting for an answer')
  const s = await getSettings()
  const until = new Date(Date.now() + s.sla.acceptTimeoutMin * 60_000)
  r.set('assignment.respondBy', until)
  r.set('assignment.timedOutAt', undefined)
  await r.save()
  await audit(user, 'request.accept_wait', 'request', r._id, { after: { respondBy: until }, label: r.requestNo }, meta)
  background(() => notifyUsers([r.assignment?.primaryStaffId], { type: 'ASSIGNED', as: 'STAFF', title: `Please accept or decline ${r.requestNo}`, body: `${r.patientSnapshot?.name ?? ''} · answer within ${s.sla.acceptTimeoutMin} min`, requestId: r._id, url: appUrl(r._id), priority: 'high' }))
}

export const DeclineInput = z.object({ reason: z.string().min(2), note: z.string().optional() })
export async function decline(r: any, input: z.infer<typeof DeclineInput>, user: SessionUser, meta: Meta) {
  if (String(r.assignment?.primaryStaffId) !== user.id) throw forbidden('Only the primary staff member can decline')
  move(r, 'CONFIRMED')
  r.set('timeline.assignedAt', undefined)
  r.assignment.declines.push({ staffId: user.id, reason: input.reason, note: input.note, at: new Date() })
  r.set('assignment.primaryStaffId', undefined)
  r.set('assignment.secondaryStaffIds', [])
  await r.save()
  await AssignmentLog.create({ requestId: r._id, fromStaffId: user.id, action: 'DECLINE', reason: input.reason, by: user.id })
  await audit(user, 'request.decline', 'request', r._id, { after: { status: 'CONFIRMED', reason: input.reason }, label: r.requestNo }, meta)
  const next = (await rankCandidates(r, 1)).find((c) => c.id !== user.id)
  background(async () => {
    await notifyRoles(['HC_ADMIN'], {
      type: 'DECLINED',
      title: `${r.requestNo} declined by ${user.name}`,
      body: `Reason: ${input.reason}${next ? ` · next best: ${next.name}` : ''}`,
      requestId: r._id,
      url: `${url(r._id)}?assign=1`,
      priority: 'high',
    })
    await visitAlertLazy('DECLINED', r._id, { staffName: user.name, reason: input.reason })
  })
}

const Stamp = z.object({ deviceAt: z.string().optional(), offline: z.boolean().optional(), lat: z.number().optional(), lng: z.number().optional(), accuracyM: z.number().optional() })
export const StampInput = Stamp

export async function enRoute(r: any, input: z.infer<typeof Stamp>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  // the bag first: every must-take item packed (Settings → Services → Bag & consumables)
  const kit = await import('./kit')
  await kit.ensureKit(r)
  const block = kit.kitBlock(r)
  if (block) throw new ApiError(409, 'BAG_NOT_READY', block)
  move(r, 'EN_ROUTE', 'enRouteAt')
  deviceStamp(r, user, 'en_route', input.deviceAt, input.offline)
  const s = await getSettings()
  const forced = onBehalf(user, r) // a coordinator marking it for the team: their own phone is not the one travelling
  const token = s.features.liveTracking && !forced ? startOut(r, user.id) : null
  await r.save()
  await audit(user, 'visit.en_route', 'request', r._id, { after: { status: 'EN_ROUTE', tracking: !!token }, label: r.requestNo }, meta)
  background(async () => {
    if (!forced) await closeOpenReturns(user.id, r._id) // left straight from the last visit: that way back is over
    await notifyRoles(['HC_ADMIN'], { type: 'EN_ROUTE', title: `${user.name} is on the way`, body: `${r.requestNo} · ${r.patientSnapshot.name}`, requestId: r._id, url: url(r._id) })
    if (token && s.features.shareTrackingWithPatient) await whatsappPatient(r, 'patient_en_route', user, user.id)
    await visitAlertLazy('EN_ROUTE', r._id, { by: user.name, onBehalf: forced })
    // a Unico car the driver didn't stamp out: the team leaving is the car leaving
    if (r.transport?.mode === 'UNICO_CAR' && !r.transport.legs?.find((l: any) => l.key === 'pickup')?.at) await carAlertLazy('CAR_OUT', r._id)
  })
}

export async function checkIn(r: any, input: z.infer<typeof Stamp>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  const s = await getSettings()
  // GPS proves the team is at the patient — not asked of a coordinator entering it for them (audited "on behalf")
  if (s.features.gpsRequiredCheckIn && (input.lat == null || input.lng == null) && !onBehalf(user, r)) throw bad('GPS location is required to check in')
  const now = new Date()
  move(r, 'IN_PROGRESS', 'checkInAt', now)
  stopTracking(r)
  r.set('visit.checkIn', { at: now, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM, deviceAt: input.deviceAt ? new Date(input.deviceAt) : undefined, offline: input.offline })
  const late = minutesBetween(r.scheduledAt, now)
  r.set('visit.lateMin', late != null && late > 0 ? late : 0)
  deviceStamp(r, user, 'check_in', input.deviceAt, input.offline)
  await r.save()
  await audit(user, 'visit.check_in', 'request', r._id, { after: { status: 'IN_PROGRESS', at: now, lateMin: r.visit.lateMin }, label: r.requestNo }, meta)
  const forced = onBehalf(user, r)
  background(async () => {
    await notifyRoles(['HC_ADMIN'], {
      type: 'CHECK_IN',
      title: `${user.name} checked in${late && late > s.sla.lateAfterMin ? ` · ${late} min late` : ''}`,
      body: `${r.requestNo} · ${r.patientSnapshot.name}`,
      requestId: r._id,
      url: url(r._id),
    })
    await visitAlertLazy('CHECKED_IN', r._id, { by: user.name, onBehalf: forced })
  })
}

export const ChecklistInput = z.object({ done: z.boolean(), note: z.string().optional(), reason: z.string().optional(), deviceAt: z.string().optional(), offline: z.boolean().optional() })
export async function tickChecklist(r: any, key: string, input: z.infer<typeof ChecklistInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  if (r.status !== 'IN_PROGRESS') throw conflict('NOT_IN_PROGRESS', 'Check in before ticking the checklist')
  const item = r.visit.checklist.find((c: any) => c.key === key)
  if (!item) throw notFound('Checklist item')
  if (!input.done && item.done && !input.reason) throw bad('Give a reason to untick', { reason: 'Required' })
  const before = { done: item.done, doneAt: item.doneAt }
  item.done = input.done
  item.doneAt = input.done ? (input.deviceAt ? new Date(input.deviceAt) : new Date()) : undefined
  item.doneBy = input.done ? user.id : undefined
  if (input.note != null) item.note = input.note
  if (!input.done) item.untickReason = input.reason
  r.markModified('visit.checklist')
  await r.save()
  await audit(user, input.done ? 'visit.tick' : 'visit.untick', 'request', r._id, { before, after: { key, done: item.done, doneAt: item.doneAt, reason: input.reason }, label: `${r.requestNo} · ${item.label}` }, meta)
  return item
}

export async function addChecklistItem(r: any, label: string, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  const key = `adhoc_${Date.now().toString(36)}`
  r.visit.checklist.push({ key, label, mandatory: false, adHoc: true, done: false })
  await r.save()
  await audit(user, 'visit.checklist_add', 'request', r._id, { after: { key, label }, label: r.requestNo }, meta)
}

export const VitalsInput = z.object(Object.fromEntries(VITALS.map((v) => [v.key, z.coerce.number().optional().nullable()])) as Record<string, z.ZodTypeAny>).extend({ flag: z.boolean().optional() })
export async function saveVitals(r: any, input: Record<string, any>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  const abnormal: string[] = []
  const v: Record<string, any> = {}
  for (const def of VITALS) {
    const x = input[def.key]
    if (x == null || x === '' || isNaN(x)) continue
    v[def.key] = Number(x)
    if (def.key !== 'weightKg' && (x < def.min || x > def.max)) abnormal.push(def.key)
  }
  r.set('visit.vitals', { ...v, recordedAt: new Date(), recordedBy: user.id, abnormal, flagged: !!input.flag || abnormal.length > 0 })
  await r.save()
  await audit(user, 'visit.vitals', 'request', r._id, { after: { ...v, abnormal }, label: r.requestNo }, meta)
  if (abnormal.length || input.flag) {
    background(() =>
      notifyRoles(['HC_ADMIN', 'DOCTOR'], {
        type: 'ABNORMAL_VITALS',
        title: `Abnormal vitals · ${r.patientSnapshot.name}`,
        body: `${r.requestNo} · ${abnormal.map((k) => `${VITALS.find((d) => d.key === k)?.label} ${v[k]}`).join(', ') || 'flagged by staff'}`,
        requestId: r._id,
        url: url(r._id),
        priority: 'high',
      }, user.id),
    )
  }
  return { abnormal }
}

export const NotesInput = z.object({ clinical: z.string().optional(), nursing: z.string().optional(), remarks: z.string().optional(), consumables: z.array(z.object({ item: z.string(), qty: z.coerce.number() })).optional() })
export async function saveNotes(r: any, input: z.infer<typeof NotesInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  if (input.clinical != null) r.set('visit.notes.clinical', input.clinical)
  if (input.nursing != null) r.set('visit.notes.nursing', input.nursing)
  if (input.remarks != null) r.set('visit.remarks', input.remarks)
  if (input.consumables) {
    // the Notes screen sends name + qty only: keep the catalog link / who / when of rows it already knew
    const prev: any[] = r.visit?.consumables ?? []
    r.set(
      'visit.consumables',
      input.consumables.map((c) => {
        const old = prev.find((p) => p.item === c.item)
        return old ? { item: c.item, qty: c.qty, itemId: old.itemId, unit: old.unit, at: old.qty === c.qty ? old.at : new Date(), by: old.qty === c.qty ? old.by : user.id } : { item: c.item, qty: c.qty, at: new Date(), by: user.id }
      }),
    )
  }
  r.set('visit.notes.updatedAt', new Date())
  await r.save()
  await audit(user, 'visit.notes', 'request', r._id, { after: { notesUpdated: true }, label: r.requestNo }, meta)
}

export const MedicationInput = z.object({ drug: z.string().min(1), dose: z.string().optional(), route: z.string().optional(), time: z.string().optional() })
export async function addMedication(r: any, input: z.infer<typeof MedicationInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  r.visit.medications.push({ ...input, time: input.time ?? fmtTime(new Date()), by: user.id, at: new Date() })
  await r.save()
  await audit(user, 'visit.medication', 'request', r._id, { after: input, label: r.requestNo }, meta)
}

export const ConfirmationInput = z.object({ type: z.enum(['PAD', 'OTP', 'VERBAL']), relation: z.string().optional(), name: z.string().optional(), attachmentId: z.string().optional() })
export async function patientConfirmation(r: any, input: z.infer<typeof ConfirmationInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  r.set('visit.confirmation', { ...input, at: new Date() })
  await r.save()
  await audit(user, 'visit.confirmation', 'request', r._id, { after: { type: input.type, relation: input.relation }, label: r.requestNo }, meta)
}

export const CheckOutInput = Stamp.extend({
  billAmount: z.coerce.number().nonnegative().optional(),
  billingStatus: z.enum(['PAID', 'DUE']).optional(),
  paymentMethod: z.enum(['CASH', 'BKASH', 'NAGAD', 'CARD']).optional(),
  transportMode: z.enum(['UNICO_CAR', 'RICKSHAW', 'UBER', 'PATHAO', 'OTHER']).optional(),
  remarks: z.string().optional(),
  complete: z.boolean().optional(),
})

/** Check-out stamps the end time, records bill + paid/due and (by default) completes the visit. */
export async function checkOut(r: any, input: z.infer<typeof CheckOutInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  if (r.status !== 'IN_PROGRESS') throw conflict('NOT_IN_PROGRESS', 'Check in first')
  const missing = r.visit.checklist.filter((c: any) => c.mandatory && !c.done)
  // Validate before stamping anything, so a rejected attempt leaves no check-out time behind
  if (input.complete !== false && missing.length) throw new ApiError(409, 'MANDATORY_MISSING', `Tick all mandatory items first: ${missing.map((m: any) => m.label).join(', ')}`)
  const now = new Date()
  r.set('visit.checkOut', { at: now, lat: input.lat, lng: input.lng, deviceAt: input.deviceAt ? new Date(input.deviceAt) : undefined, offline: input.offline })
  r.set('timeline.checkOutAt', now)
  const duration = minutesBetween(r.timeline.checkInAt, now) ?? 0
  r.set('visit.durationMin', duration)
  const s = await getSettings()
  const planned = r.expectedDurationMin ?? 45
  r.set('visit.overtimeMin', duration > planned * (1 + s.sla.overtimePct / 100) ? duration - planned : 0)
  if (input.billAmount != null) r.set('billing.billAmount', input.billAmount)
  if (input.billingStatus) r.set('billing.status', input.billingStatus)
  if (input.paymentMethod) r.set('billing.method', input.paymentMethod)
  if (input.billingStatus === 'PAID') {
    r.set('billing.collectedBy', user.id)
    r.set('billing.collectedAt', now)
  }
  if (input.transportMode) r.set('transport.mode', input.transportMode)
  if (input.remarks != null) r.set('visit.remarks', input.remarks)
  deviceStamp(r, user, 'check_out', input.deviceAt, input.offline)
  // the way back always opens ("Back at hospital" is recorded); live GPS only from the team's own phone
  const returning = await startReturn(r, user.id, { gps: !onBehalf(user, r) })
  await audit(user, 'visit.check_out', 'request', r._id, { after: { at: now, durationMin: duration, billAmount: input.billAmount, billingStatus: input.billingStatus, returnTracking: returning }, label: r.requestNo }, meta)
  if (input.complete !== false) await completeVisit(r, user, meta)
  else {
    await r.save()
    background(() => visitAlertLazy('CHECKED_OUT', r._id, { by: user.name }))
  }
}

/** "Reached hospital" button on the field app (the geofence does this on its own when the hospital pin is set). */
export async function reachedHospital(r: any, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  const { finishReturn } = await import('./tracking')
  if (!(await finishReturn(r._id, 'button', new Date(), user.id))) throw conflict('NO_RETURN_TRIP', 'This visit has no open way back')
  await audit(user, 'visit.returned', 'request', r._id, { after: { by: 'button' }, label: r.requestNo }, meta)
}

/** Coordinator sets "Back at hospital" by hand (missed tap, no hospital pin, or older visits that never opened a way back). */
export const BackAtHospitalInput = z.object({ time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'), date: z.string().optional() })
export async function recordBack(r: any, input: z.infer<typeof BackAtHospitalInput>, user: SessionUser, meta: Meta) {
  const out = r.timeline?.checkOutAt ? new Date(r.timeline.checkOutAt) : null
  if (!out) throw conflict('NOT_CHECKED_OUT', 'The team has not checked out yet')
  if (r.returnTrip?.reachedAt) throw conflict('ALREADY_BACK', `Back at hospital is already recorded (${fmtTime(r.returnTrip.reachedAt)})`)
  const at = dhakaDate(input.date ?? isoDay(out), input.time)
  if (at < out) throw bad('Back at hospital must be after check-out', { time: `After ${fmtTime(out)}` })
  if (at > new Date()) throw bad('That time is in the future', { time: 'Not later than now' })
  // a way back that was never opened (before this was recorded for every visit): open it at check-out
  if (!r.returnTrip?.startedAt || r.returnTrip?.reachedBy) await HomecareRequest.updateOne({ _id: r._id }, { $set: { returnTrip: { startedAt: out } } })
  const { finishReturn } = await import('./tracking')
  if (!(await finishReturn(r._id, 'manual', at, user.id))) throw conflict('NO_RETURN_TRIP', 'Could not record the way back')
  await audit(user, 'visit.back_manual', 'request', r._id, { after: { reachedAt: at }, label: r.requestNo }, meta)
}

export async function completeVisit(r: any, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  const missing = r.visit.checklist.filter((c: any) => c.mandatory && !c.done)
  if (missing.length) throw new ApiError(409, 'MANDATORY_MISSING', `Tick all mandatory items first: ${missing.map((m: any) => m.label).join(', ')}`)
  if (!r.timeline?.checkOutAt) throw conflict('NOT_CHECKED_OUT', 'Check out before completing')
  move(r, 'COMPLETED', 'completedAt')
  r.set('visit.reportAt', new Date())
  if (r.transport?.status && r.transport.status !== 'OWN') r.set('transport.status', 'DONE')
  await r.save()
  await audit(user, 'visit.complete', 'request', r._id, { after: { status: 'COMPLETED', durationMin: r.visit.durationMin }, label: r.requestNo }, meta)
  background(async () => {
    await visitAlertLazy('COMPLETED', r._id, { by: user.name, onBehalf: onBehalf(user, r) })
    await notifyRoles(['HC_ADMIN'], { type: 'COMPLETED', title: `${r.requestNo} completed`, body: `${user.name} · ${r.patientSnapshot.name} · ${r.visit.durationMin} min · report ready`, requestId: r._id, url: url(r._id) })
    await emailPatient(r, 'patient_completed', user)
    await whatsappPatient(r, 'patient_completed', user)
    // no way back to track (tracking off / no hospital pin): the short visit update goes out now instead
    if (!r.tracking?.active) {
      const { sendVisitUpdate } = await import('./updates')
      await sendVisitUpdate(r._id, 'auto')
    }
    const s = await getSettings()
    if (s.email.sendDepartmentReport && s.email.departmentCc.length && ruleAllows(s.notificationRules, 'COMPLETED', 'DEPARTMENT', 'email')) {
      const vars = await templateVars(r, r.assignment?.primaryStaffId)
      const t = await renderTemplate('dept_visit_report', vars)
      if (t.active)
        await queueEmail({
          to: s.email.departmentCc.join(','),
          subject: t.subject,
          text: t.text,
          templateKey: 'dept_visit_report',
          requestId: r._id,
          initiatedBy: user.id,
          cta: { label: 'Open visit report', url: await shortLink(`/print/report/${r._id}`, { kind: 'REPORT', requestId: r._id }) },
        })
    }
  })
}

export const CompleteNowInput = z.object({
  start: z.string().regex(/^\d\d:\d\d$/).optional(), // HH:mm on the visit day — when the team actually started
  end: z.string().regex(/^\d\d:\d\d$/).optional(),
  note: z.string().trim().max(300).optional(),
})
/**
 * Override: finish the visit for the team in one go (e.g. the staff did the visit but never used the app). Accepts it if
 * needed, stamps the missing check-in / check-out times (now, or the times given), ticks open mandatory checklist items as
 * "entered by coordinator" and completes it the normal way (visit update, patient message, report). Fully audited.
 */
export async function completeNow(r: any, input: z.infer<typeof CompleteNowInput>, user: SessionUser, meta: Meta) {
  if (!can(user, 'requests.override')) throw forbidden('Needs override access')
  if (!['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'].includes(r.status)) throw conflict('INVALID_TRANSITION', `A ${String(r.status).replace('_', ' ').toLowerCase()} visit can't be completed`)
  if (!r.assignment?.primaryStaffId) throw conflict('NO_TEAM', 'Assign staff first')
  const day = isoDay(r.scheduledAt ?? new Date())
  const now = new Date()
  const start = input.start ? dhakaDate(day, input.start) : r.timeline?.checkInAt ? new Date(r.timeline.checkInAt) : now
  const end = input.end ? dhakaDate(day, input.end) : now
  if (end.getTime() < start.getTime()) throw bad('The end time is before the start time', { end: 'Before start' })
  const from = r.status
  if (r.status === 'ASSIGNED') {
    move(r, 'ACCEPTED', 'acceptedAt', now)
    r.set('assignment.acceptedAt', now)
    r.set('assignment.respondBy', undefined)
    await AssignmentLog.create({ requestId: r._id, toStaffId: r.assignment.primaryStaffId, action: 'ACCEPT_BY_OVERRIDE', by: user.id, reason: 'Completed by coordinator' })
  }
  if (r.status === 'ACCEPTED' || r.status === 'EN_ROUTE') {
    move(r, 'IN_PROGRESS', 'checkInAt', start)
    r.set('visit.checkIn', { at: start })
    const late = minutesBetween(r.scheduledAt, start)
    r.set('visit.lateMin', late != null && late > 0 ? late : 0)
  }
  stopTracking(r)
  const ticked: string[] = []
  for (const c of r.visit?.checklist ?? []) {
    if (!c.mandatory || c.done) continue
    c.done = true
    c.doneAt = end
    c.doneBy = user.id
    c.note = c.note || 'Entered by coordinator'
    ticked.push(c.label)
  }
  if (ticked.length) r.markModified('visit.checklist')
  if (!r.timeline?.checkOutAt) {
    r.set('visit.checkOut', { at: end })
    r.set('timeline.checkOutAt', end)
    r.set('visit.durationMin', minutesBetween(r.timeline?.checkInAt ?? start, end) ?? 0)
  }
  if (input.note) r.set('visit.remarks', [r.visit?.remarks, input.note].filter(Boolean).join(' · '))
  const staff = await User.findById(r.assignment.primaryStaffId).select('name').lean<any>()
  await audit(user, 'visit.complete_override', 'request', r._id, { before: { status: from }, after: { for: staff?.name, start, end, ticked, note: input.note }, label: r.requestNo }, meta)
  await completeVisit(r, user, meta)
}

// ============================================================== petty cash
export const PettyCashInput = z.object({ amount: z.coerce.number().positive(), purpose: z.string().min(1), note: z.string().optional() })
export async function requestPettyCash(r: any, input: z.infer<typeof PettyCashInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  r.pettyCash.push({ ...input, requestedBy: user.id, requestedAt: new Date(), status: 'PENDING' })
  await r.save()
  const pc = r.pettyCash[r.pettyCash.length - 1]
  await Approval.create({ type: 'PETTY_CASH', requestId: r._id, payload: { pettyCashId: pc._id, amount: input.amount, purpose: input.purpose }, reason: input.note, requestedBy: user.id })
  await audit(user, 'petty_cash.request', 'request', r._id, { after: input, label: r.requestNo }, meta)
  background(() => notifyRoles(['HC_ADMIN'], { type: 'APPROVAL', title: `Petty cash ৳${input.amount} · ${r.requestNo}`, body: `${user.name} · ${input.purpose}`, requestId: r._id, url: '/settings/approvals' }))
}

export async function decidePettyCash(r: any, pettyCashId: string, approve: boolean, user: SessionUser, meta: Meta) {
  if (!can(user, 'approvals.decide')) throw forbidden()
  const pc = r.pettyCash.id(pettyCashId)
  if (!pc) throw notFound('Petty cash request')
  pc.status = approve ? 'APPROVED' : 'REJECTED'
  pc.decidedBy = user.id
  pc.decidedAt = new Date()
  await r.save()
  await Approval.updateOne({ 'payload.pettyCashId': pc._id }, { status: pc.status, decidedBy: user.id, decidedAt: new Date() })
  await audit(user, `petty_cash.${approve ? 'approve' : 'reject'}`, 'request', r._id, { after: { amount: pc.amount, status: pc.status }, label: r.requestNo }, meta)
  background(() => notifyUsers([pc.requestedBy], { type: 'APPROVAL', as: 'STAFF', event: 'PETTY_CASH', title: `Petty cash ৳${pc.amount} ${approve ? 'approved' : 'rejected'}`, body: r.requestNo, requestId: r._id, url: appUrl(r._id) }))
}

// ============================================================== transport
export const TransportInput = z.object({
  mode: z.enum(['UNICO_CAR', 'UBER', 'PATHAO', 'CNG', 'RICKSHAW', 'OTHER']),
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
  pickupTime: z.string().optional(), // HH:mm (same day as visit)
  returnTime: z.string().optional(),
  notify: NotifyField,
})
export async function assignTransport(r: any, input: z.infer<typeof TransportInput>, user: SessionUser, meta: Meta) {
  if (!can(user, 'transport.manage') && !can(user, 'requests.override')) throw forbidden()
  if (input.driverId) {
    // any active driver (the supervisor may say which one) — not only the car's usual driver
    if (!isOid(input.driverId) || !(await User.exists({ _id: input.driverId, status: 'ACTIVE', deletedAt: null, $or: [{ role: 'DRIVER' }, { roles: 'DRIVER' }] }))) throw bad('Pick an active driver', { driverId: 'Not an active driver' })
  }
  const day = isoDay(r.scheduledAt ?? new Date())
  r.set('transport.needed', true)
  r.set('transport.mode', input.mode)
  r.set('transport.assignedBy', user.id)
  r.set('transport.assignedAt', new Date())
  if (input.mode === 'UNICO_CAR') {
    if (!input.vehicleId || !isOid(input.vehicleId)) throw bad('Pick a car')
    const v = await Vehicle.findById(input.vehicleId).lean<any>()
    if (!v) throw notFound('Vehicle')
    const driverId = input.driverId ?? v.driverId
    r.set('transport.vehicleId', v._id)
    r.set('transport.driverId', driverId)
    r.set('transport.status', 'ASSIGNED')
    const pickup = input.pickupTime ? dhakaDate(day, input.pickupTime) : r.scheduledAt ? new Date(r.scheduledAt.getTime() - 40 * 60_000) : undefined
    const ret = input.returnTime ? dhakaDate(day, input.returnTime) : r.scheduledAt ? new Date(r.scheduledAt.getTime() + ((r.expectedDurationMin ?? 45) + 60) * 60_000) : undefined
    r.set('transport.pickupAt', pickup)
    r.set('transport.returnAt', ret)
    r.set('transport.legs', [
      { key: 'pickup', label: 'Pick up team at hospital', plannedAt: pickup },
      { key: 'drive', label: `Drive to patient · ${r.patientSnapshot.area ?? ''}`, plannedAt: r.scheduledAt },
      { key: 'wait', label: 'Wait during visit' },
      { key: 'return', label: 'Return to hospital', plannedAt: ret },
    ])
    await r.save()
    const note = {
      type: 'TRANSPORT',
      event: 'TRANSPORT_ASSIGNED',
      title: `${v.name} · ${v.plate} for ${r.requestNo}`,
      body: `Pick-up at hospital ${pickup ? fmtTime(pickup) : ''} · ${r.patientSnapshot.area ?? ''}`,
      requestId: r._id,
    }
    background(async () => {
      const { sendTransportDocs } = await import('./transport-docs')
      const only = notifySet(input.notify)
      await logDecision(r, ['CAR_ALLOTTED'], only, user, { vehicleId: String(v._id), driverId: driverId ? String(driverId) : undefined })
      await sendTransportDocs(r._id, 'allotted', user.id, only) // requisition with Section B + gate pass
      await carAlertLazy('CAR_ALLOTTED', r._id, {}, only)
      await notifyUsers([driverId], { ...note, as: 'DRIVER', url: '/m/trips' })
      await notifyUsers([r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])], { ...note, as: 'STAFF', url: appUrl(r._id) })
    })
  } else {
    r.set('transport.status', 'OWN')
    r.set('transport.vehicleId', undefined)
    r.set('transport.driverId', undefined)
    await r.save()
  }
  await audit(user, 'transport.assign', 'request', r._id, { after: input, label: r.requestNo }, meta)
}

export async function stampTransportLeg(r: any, legKey: string, user: SessionUser, meta: Meta) {
  if (String(r.transport?.driverId) !== user.id && !can(user, 'transport.manage')) throw forbidden()
  const leg = r.transport.legs.find((l: any) => l.key === legKey)
  if (!leg) throw notFound('Trip leg')
  leg.at = new Date()
  r.set('transport.status', legKey === 'return' ? 'DONE' : 'IN_TRIP')
  r.markModified('transport.legs')
  await r.save()
  if (r.transport.vehicleId) await Vehicle.updateOne({ _id: r.transport.vehicleId }, { status: legKey === 'return' ? 'FREE' : 'ON_TRIP' })
  await audit(user, 'transport.leg', 'request', r._id, { after: { leg: legKey, at: leg.at }, label: r.requestNo }, meta)
  if (legKey === 'pickup' || legKey === 'return') background(() => carAlertLazy(legKey === 'pickup' ? 'CAR_OUT' : 'CAR_BACK', r._id, { at: leg.at }))
}

// ============================================================== reschedule / cancel / handover asked by staff (→ approvals)
export const StaffChangeInput = z.object({ type: z.enum(['RESCHEDULE', 'CANCEL', 'HANDOVER']), reason: z.string().min(2), proposedDate: z.string().optional(), proposedSlot: z.string().optional(), note: z.string().optional(), patientInformed: z.boolean().optional() })
export async function staffChangeRequest(r: any, input: z.infer<typeof StaffChangeInput>, user: SessionUser, meta: Meta) {
  requireTeam(user, r)
  const a = await Approval.create({ type: input.type, requestId: r._id, payload: { proposedDate: input.proposedDate, proposedSlot: input.proposedSlot, patientInformed: input.patientInformed }, reason: input.reason, note: input.note, requestedBy: user.id })
  await ChatMessage.create({ requestId: r._id, kind: 'SYSTEM', text: `${user.name} asked to ${input.type.toLowerCase()}: ${input.reason}` })
  await audit(user, `request.${input.type.toLowerCase()}_asked`, 'request', r._id, { after: input, label: r.requestNo }, meta)
  background(() => notifyRoles(['HC_ADMIN'], { type: 'APPROVAL', title: `${user.name} asks to ${input.type.toLowerCase()} ${r.requestNo}`, body: input.reason, requestId: r._id, url: '/settings/approvals', priority: 'high' }))
  return a
}

// ============================================================== candidates (plan §5.5)
export type Candidate = {
  id: string
  name: string
  initials: string
  photoUrl?: string
  role: string
  designation?: string
  employeeId: string
  score: number
  skillMatch: boolean
  zoneMatch: boolean
  free: boolean
  visitsToday: number
  availability: string
  badges: string[]
  external?: boolean
}

export async function rankCandidates(r: any, limit = 20, roleFilter?: string[]): Promise<Candidate[]> {
  const at: Date = r.scheduledAt ?? new Date()
  const dur = r.expectedDurationMin ?? 45
  const { start, end } = dayRange(isoDay(at))
  const serviceIds = (r.services ?? []).map((s: any) => s.serviceTypeId).filter(Boolean)
  const [types, staff, todays] = await Promise.all([
    serviceIds.length ? ServiceType.find({ _id: { $in: serviceIds } }).select('requiredSkills').lean<any[]>() : [],
    User.find({ $or: [{ role: { $in: roleFilter ?? ['DOCTOR', 'NURSE', 'ALLIED'] } }, { roles: { $in: roleFilter ?? ['DOCTOR', 'NURSE', 'ALLIED'] } }], status: 'ACTIVE', deletedAt: null })
      .select('name role designationId employeeId availability skills zones photoUrl external hisDesignation hisDepartment').lean<any[]>(),
    HomecareRequest.find({
      ...(r._id && { _id: { $ne: r._id } }), // a request not saved yet has no id
      scheduledAt: { $gte: start, $lt: end },
      status: { $in: ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'] },
    }).select('assignment scheduledAt expectedDurationMin').lean<any[]>(),
  ])
  const required = [...new Set(types.flatMap((t) => t.requiredSkills ?? []))]
  const designationIds = [...new Set(staff.map((s) => s.designationId).filter(Boolean).map(String))]
  const desigs = designationIds.length ? await Designation.find({ _id: { $in: designationIds } }).select('title').lean<any[]>() : []
  const area = r.patientSnapshot?.area
  return staff
    .map((u) => {
      const mine = todays.filter((t) => [t.assignment?.primaryStaffId, ...(t.assignment?.secondaryStaffIds ?? [])].map(String).includes(String(u._id)))
      const buffer = 45 * 60_000
      const clash = mine.some((t) => {
        const s = new Date(t.scheduledAt).getTime()
        const e = s + (t.expectedDurationMin ?? 45) * 60_000
        return at.getTime() < e + buffer && at.getTime() + dur * 60_000 + buffer > s
      })
      const skillMatch = required.length === 0 || required.every((k) => (u.skills ?? []).includes(k))
      const zoneMatch = !area || (u.zones ?? []).includes(area)
      const onDuty = u.availability === 'ON_DUTY'
      const free = onDuty && !clash
      const score = Math.round((skillMatch ? 40 : required.filter((k) => (u.skills ?? []).includes(k)).length * (40 / Math.max(required.length, 1))) + (free ? 30 : 0) + (zoneMatch ? 20 : 0) + Math.max(0, 10 - mine.length * 3))
      const badges = [
        skillMatch ? 'Skill ✓' : 'Skill gap',
        u.availability === 'ON_LEAVE' ? 'On leave' : u.availability === 'OFF_DUTY' ? 'Off duty' : free ? `Free ${fmtTime(at)}–${fmtTime(new Date(at.getTime() + dur * 60_000))}` : 'Busy',
        zoneMatch ? 'Zone ✓' : 'Out of zone',
        `${mine.length} visit${mine.length === 1 ? '' : 's'} today`,
        ...(u.external ? ['Outside · HIS'] : []),
      ]
      return {
        id: String(u._id),
        name: u.name,
        initials: (u.name ?? '').replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/).map((x: string) => x[0]).slice(0, 2).join('').toUpperCase(),
        photoUrl: u.photoUrl,
        role: u.role,
        designation: desigs.find((d) => String(d._id) === String(u.designationId))?.title ?? u.hisDesignation,
        employeeId: u.employeeId,
        score,
        skillMatch,
        zoneMatch,
        free,
        visitsToday: mine.length,
        availability: u.availability,
        badges,
        external: !!u.external,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ============================================================== read helpers for pages
/** Populate staff / vehicle names for a list of requests (lean docs). */
export async function withPeople<T extends any[]>(rows: T): Promise<T> {
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.assignment?.primaryStaffId) ids.add(String(r.assignment.primaryStaffId))
    for (const s of r.assignment?.secondaryStaffIds ?? []) ids.add(String(s))
    if (r.transport?.driverId) ids.add(String(r.transport.driverId))
    if (r.createdBy) ids.add(String(r.createdBy))
  }
  const vehicleIds = [...new Set(rows.map((r) => r.transport?.vehicleId).filter(Boolean).map(String))]
  const [users, vehicles] = await Promise.all([
    ids.size ? User.find({ _id: { $in: [...ids] } }).select('name role employeeId phone designationId photoUrl').lean<any[]>() : [],
    vehicleIds.length ? Vehicle.find({ _id: { $in: vehicleIds } }).lean<any[]>() : [],
  ])
  const designationIds = [...new Set(users.map((u) => u.designationId).filter(Boolean).map(String))]
  const desigs = designationIds.length ? await Designation.find({ _id: { $in: designationIds } }).select('title').lean<any[]>() : []
  const person = (id: unknown) => {
    const u = users.find((x) => String(x._id) === String(id))
    if (!u) return null
    return { id: String(u._id), name: u.name, role: u.role, employeeId: u.employeeId, phone: u.phone, photoUrl: u.photoUrl as string | undefined, designation: desigs.find((d) => String(d._id) === String(u.designationId))?.title }
  }
  for (const r of rows) {
    r.primaryStaff = person(r.assignment?.primaryStaffId)
    r.secondaryStaff = (r.assignment?.secondaryStaffIds ?? []).map(person).filter(Boolean)
    r.driver = person(r.transport?.driverId)
    r.createdByUser = person(r.createdBy)
    const v = vehicles.find((x) => String(x._id) === String(r.transport?.vehicleId))
    r.vehicle = v ? { id: String(v._id), name: v.name, plate: v.plate, model: v.model } : null
  }
  return rows
}

/** SLA tone for a request: g / a / r plus label (SLAPill). */
export function slaInfo(r: any, settings?: { sla: { confirmRoutineMin: number; confirmUrgentMin: number; assignMin: number; acceptTimeoutMin: number; lateAfterMin: number } }) {
  const sla = settings?.sla ?? { confirmRoutineMin: 15, confirmUrgentMin: 5, assignMin: 30, acceptTimeoutMin: 15, lateAfterMin: 10 }
  const now = Date.now()
  const mins = (d: any) => Math.round((now - new Date(d).getTime()) / 60000)
  const tone = (left: number, total: number) => (left < 0 ? 'r' : left < total * 0.3 ? 'a' : 'g')
  if (['NEW', 'VERIFIED'].includes(r.status) && r.timeline?.requestedAt) {
    const total = r.priority === 'ROUTINE' ? sla.confirmRoutineMin : r.priority === 'URGENT' ? sla.confirmUrgentMin : 2
    const left = total - mins(r.timeline.requestedAt)
    return { tone: tone(left, total), label: left < 0 ? `Overdue ${-left} min` : `Confirm in ${left} min`, dueAt: new Date(new Date(r.timeline.requestedAt).getTime() + total * 60000) }
  }
  if (r.status === 'CONFIRMED' && r.timeline?.confirmedAt) {
    // Visits booked for a later day: assignment SLA does not apply until the day before
    if (r.scheduledAt && new Date(r.scheduledAt).getTime() - now > 24 * 3600_000) return { tone: 'g', label: `Visit ${fmtDate(r.scheduledAt).replace(/ \d{4}$/, '')}`, dueAt: null }
    const left = sla.assignMin - mins(r.timeline.confirmedAt)
    return { tone: tone(left, sla.assignMin), label: left < 0 ? `Assign overdue ${-left} min` : `Assign in ${left} min`, dueAt: new Date(new Date(r.timeline.confirmedAt).getTime() + sla.assignMin * 60000) }
  }
  if (r.status === 'ASSIGNED' && r.assignment?.respondBy) {
    const left = Math.round((new Date(r.assignment.respondBy).getTime() - now) / 60000)
    return { tone: tone(left, sla.acceptTimeoutMin), label: left < 0 ? `No response ${-left} min` : `Respond in ${left} min`, dueAt: r.assignment.respondBy }
  }
  if (['ACCEPTED', 'EN_ROUTE'].includes(r.status) && r.scheduledAt) {
    const left = Math.round((new Date(r.scheduledAt).getTime() - now) / 60000)
    if (left < -sla.lateAfterMin) return { tone: 'r', label: `Overdue ${-left} min`, dueAt: r.scheduledAt }
    return { tone: left < 30 ? 'a' : 'g', label: left < 0 ? `Due ${-left} min ago` : left < 90 ? `Starts in ${left} min` : `At ${fmtTime(r.scheduledAt)}`, dueAt: r.scheduledAt }
  }
  if (r.status === 'IN_PROGRESS' && r.timeline?.checkInAt) {
    const el = mins(r.timeline.checkInAt)
    const planned = r.expectedDurationMin ?? 45
    return { tone: el > planned * 1.25 ? 'r' : el > planned ? 'a' : 'g', label: `${el} / ${planned} min`, dueAt: null }
  }
  return null
}
