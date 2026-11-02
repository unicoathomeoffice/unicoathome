import 'server-only'
import { z } from 'zod'
import { Attachment, Department, Designation, ExpenseClaim, HomecareRequest, Patient, User } from '../models'
import { can, TRANSPORT_MODE_LABEL } from '../constants'
import { audit } from '../audit'
import { bad, conflict, forbidden, notFound } from '../api'
import { notifyRoles, notifyUsers, waNumber } from '../messaging'
import { canQueue } from '../wa/status'
import { getSettings } from '../settings'
import { readFile, storeFile } from '../files'
import { claimPdf, claimXlsx } from '../forms/claim'
import { taka } from '../format'
import { onCallSupervisors } from './transport-docs'
import type { SessionUser } from '../auth'

// Expense claims (conveyance by rickshaw / Uber / Pathao, food, other) on the hospital's Bill Submission form.
// Each staff member has one open DRAFT; lines can be added any time (suggested from their visits), then Submit makes
// the filled workbook + PDF and sends them to the on-call security supervisor (and a copy to the staff member).

type Meta = { ip?: string; userAgent?: string; client?: string }
export const CLAIM_MODES = ['Rickshaw', 'Uber', 'Pathao', 'CNG', 'Bus', 'Other'] as const
const MODE_FROM_TRANSPORT: Record<string, string> = { RICKSHAW: 'Rickshaw', UBER: 'Uber', PATHAO: 'Pathao', OTHER: 'Other' }

export const LineInput = z.object({
  kind: z.enum(['CONVEYANCE', 'FOOD', 'OTHER']),
  requestId: z.string().optional(),
  leg: z.enum(['OUT', 'BACK']).optional(),
  at: z.string().optional(), // ISO
  uhid: z.string().max(40).optional(),
  patientName: z.string().max(120).optional(),
  invoiceNo: z.string().max(60).optional(),
  from: z.string().max(160).optional(),
  to: z.string().max(160).optional(),
  mode: z.string().max(60).optional(),
  amount: z.coerce.number().positive('Enter the amount').max(100_000),
  receiptIds: z.array(z.string()).max(5).default([]),
  note: z.string().max(300).optional(),
})
export const LinePatch = LineInput.partial()

const total = (c: any) => (c.lines ?? []).reduce((a: number, l: any) => a + (l.amount ?? 0), 0)

/** The user's open claim (created on first use). Claim no: CL-<employee>-<yymm>-<n>. */
export async function draftOf(user: { id: string; employeeId: string }) {
  const open = await ExpenseClaim.findOne({ userId: user.id, status: 'DRAFT' })
  if (open) return open
  const ym = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: '2-digit', month: '2-digit' }).format(new Date()).split('/').reverse().join('')
  const n = (await ExpenseClaim.countDocuments({ userId: user.id, claimNo: new RegExp(`-${ym}-`) })) + 1
  return ExpenseClaim.create({ claimNo: `CL-${user.employeeId}-${ym}-${String(n).padStart(2, '0')}`, userId: user.id })
}

/** Trips the user could claim: their visits in the last 30 days without the Unico car, minus legs already claimed. */
export async function suggestions(user: SessionUser) {
  const since = new Date(Date.now() - 30 * 86400_000)
  const visits = await HomecareRequest.find({
    deletedAt: null,
    status: { $in: ['IN_PROGRESS', 'COMPLETED', 'CLOSED'] },
    'timeline.checkInAt': { $gte: since },
    $or: [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }],
    'transport.mode': { $ne: 'UNICO_CAR' },
  })
    .sort({ 'timeline.checkInAt': -1 })
    .limit(40)
    .select('requestNo patientId patientSnapshot timeline transport returnTrip billing pettyCash')
    .lean<any[]>()
  if (!visits.length) return []
  const claimed = await ExpenseClaim.find({ userId: user.id, 'lines.requestId': { $in: visits.map((v) => v._id) } }).select('lines.requestId lines.leg').lean<any[]>()
  const taken = new Set(claimed.flatMap((c) => c.lines.filter((l: any) => l.requestId).map((l: any) => `${l.requestId}:${l.leg ?? ''}`)))
  const patients = await Patient.find({ _id: { $in: visits.map((v) => v.patientId) } }).select('uhid address').lean<any[]>()
  const s = await getSettings()
  const hospital = s.general.hospitalName.replace(/\s+PLC$/i, '')
  const out: any[] = []
  for (const v of visits) {
    const p = patients.find((x) => String(x._id) === String(v.patientId))
    const addr = [p?.address?.house && `House ${p.address.house}`, v.patientSnapshot?.address].filter(Boolean).join(', ') || v.patientSnapshot?.area || ''
    const mode = MODE_FROM_TRANSPORT[v.transport?.mode] ?? ''
    // amount from this user's petty cash for travel on that visit, if any (split across the two legs)
    const pc = (v.pettyCash ?? []).filter((x: any) => String(x.requestedBy) === user.id && /rickshaw|uber|pathao|transport|travel/i.test(x.purpose ?? '') && x.status !== 'REJECTED').reduce((a: number, x: any) => a + (x.amount ?? 0), 0)
    const base = { kind: 'CONVEYANCE', requestId: String(v._id), requestNo: v.requestNo, uhid: p?.uhid ?? v.patientSnapshot?.uhid ?? '', patientName: v.patientSnapshot?.name ?? '', invoiceNo: v.billing?.invoiceNo ?? '', mode }
    if (!taken.has(`${v._id}:OUT`)) out.push({ ...base, leg: 'OUT', at: v.timeline?.enRouteAt ?? v.timeline?.checkInAt, from: hospital, to: addr, amount: pc ? Math.round(pc / 2) : null })
    if (!taken.has(`${v._id}:BACK`) && v.timeline?.checkOutAt) out.push({ ...base, leg: 'BACK', at: v.timeline.checkOutAt, from: addr, to: hospital, amount: pc ? pc - Math.round(pc / 2) : null })
  }
  return out
}

async function checkReceipts(ids: string[], user: SessionUser) {
  if (!ids.length) return
  const n = await Attachment.countDocuments({ _id: { $in: ids }, uploadedBy: user.id, deletedAt: null })
  if (n !== ids.length) throw bad('A receipt file was not found')
}

export async function addLine(user: SessionUser, input: z.infer<typeof LineInput>, meta: Meta) {
  await checkReceipts(input.receiptIds, user)
  const c = await draftOf(user)
  if (input.requestId && input.leg && c.lines.some((l: any) => String(l.requestId) === input.requestId && l.leg === input.leg)) throw conflict('DUPLICATE', 'This trip is already on your claim')
  c.lines.push({ ...input, at: input.at ? new Date(input.at) : new Date() })
  c.total = total(c)
  await c.save()
  await audit(user, 'claim.line_add', 'claim', c._id, { after: { kind: input.kind, amount: input.amount, requestId: input.requestId }, label: c.claimNo }, meta)
  return c
}

export async function updateLine(user: SessionUser, lineId: string, patch: z.infer<typeof LinePatch>, meta: Meta) {
  const c = await ExpenseClaim.findOne({ userId: user.id, status: 'DRAFT', 'lines._id': lineId })
  if (!c) throw notFound('Claim line')
  if (patch.receiptIds) await checkReceipts(patch.receiptIds, user)
  const l = c.lines.id(lineId)
  Object.assign(l, { ...patch, ...(patch.at ? { at: new Date(patch.at) } : {}) })
  c.total = total(c)
  await c.save()
  await audit(user, 'claim.line_update', 'claim', c._id, { after: patch, label: c.claimNo }, meta)
  return c
}

export async function removeLine(user: SessionUser, lineId: string, meta: Meta) {
  const c = await ExpenseClaim.findOne({ userId: user.id, status: 'DRAFT', 'lines._id': lineId })
  if (!c) throw notFound('Claim line')
  c.lines.id(lineId).deleteOne()
  c.total = total(c)
  await c.save()
  await audit(user, 'claim.line_remove', 'claim', c._id, { label: c.claimNo }, meta)
  return c
}

async function employee(userId: unknown) {
  const u = await User.findById(userId).select('name employeeId designationId departmentId phone whatsapp signatureId').lean<any>()
  if (!u) throw notFound('User')
  const d = u.designationId ? await Designation.findById(u.designationId).select('title departmentId').lean<any>() : null
  const depId = u.departmentId ?? d?.departmentId
  const dep = depId ? await Department.findById(depId).select('name').lean<any>() : null
  return { u, name: u.name as string, employeeId: u.employeeId as string, designation: (d?.title ?? '') as string, department: (dep?.name ?? 'Home Care') as string }
}

/** Build the workbook + PDF for a claim (stored as attachments on the claim owner). */
export async function buildClaimFiles(c: any) {
  const e = await employee(c.userId)
  const [sign, approver] = await Promise.all([e.u.signatureId ? readFile(e.u.signatureId) : null, c.decidedBy && c.status !== 'REJECTED' ? User.findById(c.decidedBy).select('name signatureId').lean<any>() : null])
  const approvedSign = approver?.signatureId ? await readFile(approver.signatureId) : null
  const receipts: { data: Buffer; mime: string; label: string }[] = []
  for (const l of c.lines) for (const id of l.receiptIds ?? []) {
    const f = await readFile(id)
    if (f) receipts.push({ ...f, label: `${l.mode ?? l.kind} · ${taka(l.amount)}` })
  }
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', year: 'numeric' }).format(c.submittedAt ?? new Date())
  const form = {
    claimNo: c.claimNo,
    date,
    employee: { name: e.name, designation: e.designation, employeeId: e.employeeId, department: e.department },
    lines: c.lines.map((l: any) => ({ kind: l.kind, at: l.at, uhid: l.uhid, patientName: l.patientName, invoiceNo: l.invoiceNo, from: l.from, to: l.to, mode: l.mode, amount: l.amount })),
    preparedSign: sign ? { data: sign.data, mime: sign.mime } : null,
    approvedBy: approver?.name,
    approvedSign: approvedSign ? { data: approvedSign.data, mime: approvedSign.mime } : null,
    receipts,
  }
  const [xlsx, pdf] = await Promise.all([claimXlsx(form), claimPdf(form)])
  const base = `Bill-Submission-${c.claimNo}`
  const [x, p] = await Promise.all([
    storeFile({ data: xlsx, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${base}.xlsx`, kind: 'CLAIM', ownerType: 'USER', ownerId: c.userId, uploadedBy: String(c.userId) }),
    storeFile({ data: pdf, mime: 'application/pdf', filename: `${base}.pdf`, kind: 'CLAIM', ownerType: 'USER', ownerId: c.userId, uploadedBy: String(c.userId) }),
  ])
  c.xlsxId = x._id
  c.pdfId = p._id
  return { e, x, p }
}

/** WhatsApp the claim files to the on-call security supervisor(s) and a copy to the staff member. */
async function sendClaim(c: any, e: Awaited<ReturnType<typeof employee>>, x: any, p: any, initiatedBy?: string) {
  if (!(await canQueue())) return 0
  const { queueWhatsApp } = await import('../wa/service')
  const caption = `Bill submission · ${c.claimNo}\n${e.name} (${e.employeeId}) · ${e.designation}\nTotal ${taka(c.total)} · ${c.lines.length} item${c.lines.length === 1 ? '' : 's'}${c.status !== 'SUBMITTED' ? ` · ${c.status.toLowerCase()}` : ''}`
  let sent = 0
  const { groupRecipients } = await import('./hod')
  const to = [
    ...(await onCallSupervisors()).map((s) => ({ name: `${s.name} (security supervisor)`, phone: s.phone })),
    ...(await groupRecipients('CLAIM')).map((g) => ({ name: `${g.name} (${g.group.name})`, phone: g.phone })), // Security / Transport groups
    ...(e.u.whatsapp || e.u.phone ? [{ name: `${e.name} (copy)`, phone: e.u.whatsapp || e.u.phone }] : []),
  ]
  const seen = new Set<string>()
  for (const r of to) {
    const n = waNumber(r.phone)
    if (!n || seen.has(n)) continue
    seen.add(n)
    await queueWhatsApp({ to: r.phone, toName: r.name, text: caption, templateKey: 'claim_form', initiatedBy, attachmentId: p._id, fileName: p.filename })
    await queueWhatsApp({ to: r.phone, toName: r.name, text: `Excel · ${c.claimNo}`, templateKey: 'claim_form', initiatedBy, attachmentId: x._id, fileName: x.filename })
    sent += 2
  }
  return sent
}

export async function submitClaim(user: SessionUser, meta: Meta) {
  const c = await ExpenseClaim.findOne({ userId: user.id, status: 'DRAFT' })
  if (!c || !c.lines.length) throw bad('Add at least one expense first')
  c.status = 'SUBMITTED'
  c.submittedAt = new Date()
  c.total = total(c)
  const { e, x, p } = await buildClaimFiles(c)
  c.sentAt = new Date()
  await c.save()
  const sent = await sendClaim(c, e, x, p, user.id)
  await audit(user, 'claim.submit', 'claim', c._id, { after: { total: c.total, lines: c.lines.length, sent }, label: c.claimNo }, meta)
  await notifyRoles(['HC_ADMIN'], { type: 'APPROVAL', title: `Bill submission ${c.claimNo} · ${taka(c.total)}`, body: `${user.name} · ${c.lines.length} item${c.lines.length === 1 ? '' : 's'}`, url: '/claims' })
  return { id: String(c._id), sent }
}

export async function decideClaim(id: string, input: { approve: boolean; note?: string }, user: SessionUser, meta: Meta) {
  if (!can(user, 'approvals.decide')) throw forbidden()
  const c = await ExpenseClaim.findById(id)
  if (!c) throw notFound('Claim')
  if (c.status !== 'SUBMITTED') throw conflict('NOT_SUBMITTED', 'Only submitted claims can be approved or rejected')
  c.status = input.approve ? 'APPROVED' : 'REJECTED'
  c.decidedBy = user.id
  c.decidedAt = new Date()
  c.decisionNote = input.note
  if (input.approve) await buildClaimFiles(c) // re-made with "Approved By" + signature
  await c.save()
  await audit(user, input.approve ? 'claim.approve' : 'claim.reject', 'claim', c._id, { after: { note: input.note }, label: c.claimNo }, meta)
  await notifyUsers([c.userId], { type: 'APPROVAL', title: `${c.claimNo} ${input.approve ? 'approved' : 'rejected'} · ${taka(c.total)}`, body: input.note, url: '/m/claims' })
}

export async function markPaid(id: string, user: SessionUser, meta: Meta) {
  if (!can(user, 'approvals.decide')) throw forbidden()
  const c = await ExpenseClaim.findById(id)
  if (!c) throw notFound('Claim')
  if (c.status !== 'APPROVED') throw conflict('NOT_APPROVED', 'Approve the claim first')
  c.status = 'PAID'
  c.paidAt = new Date()
  c.paidBy = user.id
  await c.save()
  await audit(user, 'claim.paid', 'claim', c._id, { label: c.claimNo }, meta)
  await notifyUsers([c.userId], { type: 'APPROVAL', title: `${c.claimNo} paid · ${taka(c.total)}`, url: '/m/claims' })
}

/** Resend (owner or approver): files are re-made with the current state and sent again. */
export async function resendClaim(id: string, user: SessionUser, meta: Meta) {
  const c = await ExpenseClaim.findById(id)
  if (!c) throw notFound('Claim')
  if (String(c.userId) !== user.id && !can(user, 'approvals.decide')) throw forbidden()
  if (c.status === 'DRAFT') throw bad('Submit the claim first')
  const { e, x, p } = await buildClaimFiles(c)
  c.sentAt = new Date()
  await c.save()
  const sent = await sendClaim(c, e, x, p, user.id)
  await audit(user, 'claim.resend', 'claim', c._id, { after: { sent }, label: c.claimNo }, meta)
  return { sent }
}

export const modeLabel = (m?: string) => (m ? (TRANSPORT_MODE_LABEL as any)[m] ?? m : '')
