import 'server-only'
import { Attachment, CarePlan, HomecareRequest, LabResult, Patient } from '../models'
import { VITALS } from '../constants'
import { describeSchedule } from '../schedule-dates'
import type { PatientSession } from '../patient-auth'

// The patient's own home care module under /my — view only. Everything is limited to the patient records that are this
// person (their phone or UHID). Kept out on purpose: staff phone numbers and details, live tracking, the car / driver,
// internal notes, staff receipts and anything else the care team uses internally.

/** Every patient record that is this person: their phone, or their hospital UHID. */
export async function patientIds(session: PatientSession) {
  const rows = await Patient.find({ deletedAt: null, $or: [{ phone: session.phone }, ...(session.uhid ? [{ uhid: session.uhid }] : [])] }).select('_id').lean<any[]>()
  return rows.map((p) => p._id)
}

/** files a patient may open: their reports, prescriptions, visit reports and bills (never staff receipts or photos) */
export const PATIENT_FILE_KINDS = ['REPORT', 'PRESCRIPTION', 'VISIT_REPORT', 'INVOICE'] as const

const liveBills = (r: any) => (r.billing?.invoices ?? []).filter((i: any) => !i.replacedBy)
const serviceNames = (r: any) => (r.services ?? []).map((s: any) => s.name).filter(Boolean).join(', ')

export type VitalsRow = { requestId: string; requestNo: string; at: string; values: { key: string; label: string; unit: string; value: number; out: boolean }[] }
export type BillRow = { requestId: string; requestNo: string; service: string; invoiceNo: string; date: string | null; payable: number; paid: number; due: number; fileId: string | null }
export type DocRow = { id: string; kind: string; name: string; at: string; requestNo?: string; requestId?: string }

/** vitals the team recorded at each visit, newest first */
export function vitalsOf(rows: any[]): VitalsRow[] {
  return rows
    .filter((r) => r.visit?.vitals && Object.keys(r.visit.vitals).some((k) => typeof r.visit.vitals[k] === 'number'))
    .map((r) => ({
      requestId: String(r._id),
      requestNo: r.requestNo,
      at: new Date(r.visit.vitals.recordedAt ?? r.timeline?.checkInAt ?? r.scheduledAt ?? r.createdAt).toISOString(),
      values: VITALS.filter((v) => typeof r.visit.vitals[v.key] === 'number').map((v) => {
        const value = r.visit.vitals[v.key] as number
        return { key: v.key, label: v.label, unit: v.unit, value, out: value < v.min || value > v.max }
      }),
    }))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
}

export function billsOf(rows: any[]): BillRow[] {
  return rows
    .flatMap((r) =>
      liveBills(r).map((i: any) => ({
        requestId: String(r._id),
        requestNo: r.requestNo,
        service: serviceNames(r),
        invoiceNo: i.invoiceNo || '—',
        date: i.date ? new Date(i.date).toISOString() : null,
        payable: Number(i.payable) || 0,
        paid: Number(i.paid) || 0,
        due: Number(i.due) || 0,
        fileId: i.attachmentId ? String(i.attachmentId) : null,
      })),
    )
    .sort((a, b) => +new Date(b.date ?? 0) - +new Date(a.date ?? 0))
}

const VISIT_FIELDS = 'requestNo status scheduledAt slot preferred services timeline visit.vitals visit.medications billing.invoices billing.status carePlanId createdAt'

/** Everything the module shows, in one read (the patient has tens of visits, not thousands). */
export async function patientModule(session: PatientSession) {
  const ids = await patientIds(session)
  const rows = await HomecareRequest.find({ patientId: { $in: ids }, deletedAt: null }).select(VISIT_FIELDS).sort({ createdAt: -1 }).limit(300).lean<any[]>()
  const reqIds = rows.map((r) => r._id)
  const [labs, files, plans, profile] = await Promise.all([
    LabResult.find({ $or: [{ patientId: { $in: ids } }, { requestId: { $in: reqIds } }], status: 'RESULTED' }).sort({ resultedAt: -1 }).limit(200).lean<any[]>(),
    Attachment.find({ deletedAt: null, kind: { $in: PATIENT_FILE_KINDS }, $or: [{ requestId: { $in: reqIds } }, { ownerType: 'PATIENT', ownerId: { $in: ids } }] }).select('kind filename caption at requestId').sort({ at: -1 }).limit(300).lean<any[]>(),
    CarePlan.find({ patientId: { $in: ids }, 'pattern.kind': { $exists: true } }).sort({ status: 1, updatedAt: -1 }).lean<any[]>(),
    Patient.findById(session.id).select('uhid category company ageYears gender address').lean<any>(),
  ])
  const byId = new Map(rows.map((r) => [String(r._id), r]))
  const now = Date.now()

  const bills = billsOf(rows)
  const docs: DocRow[] = files.map((f) => {
    const r = f.requestId ? byId.get(String(f.requestId)) : null
    return { id: String(f._id), kind: f.kind, name: f.caption || f.filename || f.kind, at: new Date(f.at ?? Date.now()).toISOString(), requestNo: r?.requestNo, requestId: r ? String(r._id) : undefined }
  })
  const medicines = rows
    .flatMap((r) => (r.visit?.medications ?? []).map((m: any) => ({ requestId: String(r._id), requestNo: r.requestNo, drug: m.drug, dose: m.dose, route: m.route, time: m.time, at: m.at ? new Date(m.at).toISOString() : null })))
    .sort((a, b) => +new Date(b.at ?? 0) - +new Date(a.at ?? 0))
  const schedules = plans.map((p) => {
    const mine = rows.filter((r) => String(r.carePlanId) === String(p._id) && r.status !== 'CANCELLED')
    const upcoming = mine.filter((r) => r.scheduledAt && +new Date(r.scheduledAt) > now).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
    return {
      id: String(p._id),
      title: (p.services ?? []).map((s: any) => s.name).join(', ') || p.title || 'Home care visits',
      rule: describeSchedule(p.pattern, p.end),
      time: p.time as string | undefined,
      status: p.status as string,
      done: mine.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length,
      total: p.end?.kind === 'COUNT' ? (p.end.count as number) : null,
      next: upcoming.slice(0, 4).map((r) => ({ id: String(r._id), at: new Date(r.scheduledAt).toISOString() })),
    }
  })
  const upcoming = rows.filter((r) => !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status))
  const next = upcoming.filter((r) => r.scheduledAt).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))[0] ?? upcoming[0] ?? null

  return {
    profile: { uhid: profile?.uhid ?? session.uhid ?? null, category: profile?.category ?? null, company: profile?.company ?? null, ageYears: profile?.ageYears ?? null, gender: profile?.gender ?? null, address: [profile?.address?.full, profile?.address?.area].filter(Boolean).join(', ') || null },
    counts: {
      upcoming: upcoming.length,
      done: rows.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length,
      due: bills.reduce((a, b) => a + b.due, 0),
      paid: bills.reduce((a, b) => a + b.paid, 0),
      docs: docs.length,
      schedules: schedules.filter((s) => s.status === 'ACTIVE').length,
    },
    next: next ? { id: String(next._id), requestNo: next.requestNo, status: next.status, service: serviceNames(next), at: next.scheduledAt ? new Date(next.scheduledAt).toISOString() : null, preferred: next.preferred?.date ?? null, slot: next.slot ?? next.preferred?.slot ?? null } : null,
    vitals: vitalsOf(rows),
    labs: labs.map((l) => ({ id: String(l._id), test: l.test, value: l.value, unit: l.unit, refRange: l.refRange, flag: l.flag, summary: l.summary, at: l.resultedAt ? new Date(l.resultedAt).toISOString() : null })),
    medicines,
    bills,
    docs,
    schedules,
  }
}
export type PatientModule = Awaited<ReturnType<typeof patientModule>>

/** May this patient open this file? (their visits, or a file on their own record; patient file kinds only) */
export async function patientFile(session: PatientSession, fileId: string) {
  const a = await Attachment.findOne({ _id: fileId, deletedAt: null, kind: { $in: PATIENT_FILE_KINDS } }).select('+data +blobUrl').lean<any>()
  if (!a) return null
  const ids = await patientIds(session)
  if (a.requestId) {
    const ok = await HomecareRequest.exists({ _id: a.requestId, patientId: { $in: ids }, deletedAt: null })
    return ok ? a : null
  }
  return a.ownerType === 'PATIENT' && ids.some((id) => String(id) === String(a.ownerId)) ? a : null
}

/** One visit's records for its page: vitals, medicines, bills, documents (the visit is already checked as theirs). */
export async function visitRecords(r: any) {
  const files = await Attachment.find({ requestId: r._id, deletedAt: null, kind: { $in: PATIENT_FILE_KINDS } }).select('kind filename caption at').sort({ at: -1 }).lean<any[]>()
  return {
    vitals: vitalsOf([r])[0] ?? null,
    medicines: ((r.visit?.medications ?? []) as any[]).map((m): { drug: string; dose?: string; route?: string; time?: string } => ({ drug: m.drug, dose: m.dose, route: m.route, time: m.time })),
    bills: billsOf([r]),
    docs: files.map((f): DocRow => ({ id: String(f._id), kind: f.kind, name: f.caption || f.filename || f.kind, at: new Date(f.at ?? Date.now()).toISOString() })),
  }
}
export type VisitRecords = Awaited<ReturnType<typeof visitRecords>>
