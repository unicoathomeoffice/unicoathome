import 'server-only'
import { z } from 'zod'
import { Attachment, Patient, User } from '../models'
import { can } from '../constants'
import { audit } from '../audit'
import { bad, forbidden, notFound } from '../api'
import { renderTemplate } from '../messaging'
import { isPaired } from '../wa/status'
import { date as fmtDate, taka } from '../format'
import { templateVars } from './requests'
import type { SessionUser } from '../auth'

// Invoice tab: the hospital bills of a visit (uploaded here or fetched from H360), its payment status
// (Paid / Partially paid / Due / Waived) and sending the bill PDFs on WhatsApp.

type Meta = { ip?: string; userAgent?: string; client?: string }
const money = z.coerce.number().nonnegative()

const Item = z.object({ name: z.string().trim().min(1).max(160), rate: money, qty: z.coerce.number().positive().max(1000), discount: money.default(0), amount: money })
export const InvoiceInput = z
  .object({
  invoiceNo: z.string().trim().max(40).default(''),
  date: z.string().optional(), // YYYY-MM-DD
  total: money.default(0),
  discount: money.optional(),
  payable: money.optional(),
  paid: money.default(0),
  due: money.optional(),
  attachmentId: z.string().optional(),
  source: z.enum(['UPLOAD', 'H360']).default('UPLOAD'),
  note: z.string().max(300).optional(),
  trxId: z.string().trim().max(40).optional(),
  items: z.array(Item).max(80).optional(),
  /** save the bill file now, fill the invoice no / amounts later */
  needsDetails: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.needsDetails) {
      if (!v.attachmentId) ctx.addIssue({ code: 'custom', path: ['attachmentId'], message: 'Choose the bill file first' })
      return
    }
    if (!v.invoiceNo) ctx.addIssue({ code: 'custom', path: ['invoiceNo'], message: 'Invoice no is required' })
  })
export const InvoicePatch = z.object({
  invoiceNo: z.string().trim().min(1, 'Invoice no is required').max(40).optional(),
  date: z.string().optional(),
  total: money.optional(),
  discount: money.optional(),
  payable: money.optional(),
  paid: money.optional(),
  due: money.optional(),
  attachmentId: z.string().optional(),
  note: z.string().max(300).optional(),
  trxId: z.string().trim().max(40).optional(),
  items: z.array(Item).max(80).optional(),
})
export const BillingStatusInput = z.object({ status: z.enum(['PAID', 'PARTIAL', 'DUE', 'WAIVED']).nullable() })
export const SendInvoicesInput = z.object({ invoiceIds: z.array(z.string()).min(1, 'Pick at least one invoice'), patient: z.boolean().default(true), staffIds: z.array(z.string()).default([]) })

function needBilling(user: SessionUser) {
  if (!can(user, 'billing.invoice')) throw forbidden('Only billing / front desk can change invoices')
}

/** payable = total − discount (unless given); due = payable − paid (unless given) */
export function amounts(i: { total: number; discount?: number; payable?: number; paid?: number; due?: number }) {
  const payable = i.payable ?? Math.max(0, i.total - (i.discount ?? 0))
  const paid = i.paid ?? 0
  const due = i.due ?? Math.max(0, payable - paid)
  return { total: i.total, discount: i.discount ?? 0, payable, paid, due }
}

/** Request totals + status from its invoices; billing.invoiceNo / invoiceAmount stay in step for close-out and reports. */
export function recompute(r: any) {
  const list = r.billing?.invoices ?? []
  const payable = list.reduce((a: number, x: any) => a + (x.payable ?? 0), 0)
  const paid = list.reduce((a: number, x: any) => a + (x.paid ?? 0), 0)
  const due = list.reduce((a: number, x: any) => a + (x.due ?? 0), 0)
  r.set('billing.paidAmount', paid)
  r.set('billing.dueAmount', due)
  if (list.length) {
    r.set('billing.invoiceNo', list.map((x: any) => x.invoiceNo).filter(Boolean).join(', '))
    r.set('billing.invoiceAmount', payable)
  }
  const derived = !list.length ? r.billing?.status : due <= 0 ? 'PAID' : paid <= 0 ? 'DUE' : 'PARTIAL'
  r.set('billing.status', r.billing?.statusOverride ?? derived)
}

export async function addInvoice(r: any, input: z.infer<typeof InvoiceInput>, user: SessionUser, meta: Meta) {
  needBilling(user)
  if (input.invoiceNo && (r.billing?.invoices ?? []).some((x: any) => x.invoiceNo === input.invoiceNo)) throw bad(`Invoice ${input.invoiceNo} is already on this request`, { invoiceNo: 'Already added' })
  if (input.attachmentId) {
    const a = await Attachment.findOne({ _id: input.attachmentId, deletedAt: null }).select('requestId kind').lean<any>()
    if (!a || String(a.requestId) !== String(r._id)) throw bad('The invoice file does not belong to this request')
    if (a.kind !== 'INVOICE') await Attachment.updateOne({ _id: a._id }, { kind: 'INVOICE' })
  }
  const now = new Date()
  r.billing.invoices.push({
    invoiceNo: input.invoiceNo,
    date: input.date ? new Date(`${input.date}T12:00:00+06:00`) : now,
    ...amounts(input),
    attachmentId: input.attachmentId,
    source: input.source,
    note: input.note,
    trxId: input.trxId,
    items: input.items,
    needsDetails: input.needsDetails || undefined,
    addedBy: user.id,
    addedAt: now,
  })
  recompute(r)
  await r.save()
  await audit(user, 'request.bill_link', 'request', r._id, { after: { invoiceNo: input.invoiceNo || '(details later)', ...amounts(input), source: input.source, items: input.items?.length }, label: r.requestNo }, meta)
}

export async function updateInvoice(r: any, invoiceId: string, patch: z.infer<typeof InvoicePatch>, user: SessionUser, meta: Meta) {
  needBilling(user)
  const inv = r.billing?.invoices?.id(invoiceId)
  if (!inv) throw notFound('Invoice')
  const before = { invoiceNo: inv.invoiceNo, total: inv.total, discount: inv.discount, payable: inv.payable, paid: inv.paid, due: inv.due }
  const next = { total: patch.total ?? inv.total, discount: patch.discount ?? inv.discount, paid: patch.paid ?? inv.paid, payable: patch.payable, due: patch.due }
  // payable / due follow the other numbers unless they were typed in this edit
  Object.assign(inv, amounts({ ...next, payable: patch.payable ?? (patch.total != null || patch.discount != null ? undefined : inv.payable) }))
  if (patch.invoiceNo) inv.invoiceNo = patch.invoiceNo
  if (patch.date) inv.date = new Date(`${patch.date}T12:00:00+06:00`)
  if (patch.note != null) inv.note = patch.note
  if (patch.attachmentId) inv.attachmentId = patch.attachmentId
  if (patch.trxId) inv.trxId = patch.trxId
  if (patch.items) inv.items = patch.items
  if (inv.needsDetails && inv.invoiceNo && (inv.total ?? 0) > 0) inv.needsDetails = undefined
  inv.updatedAt = new Date()
  recompute(r)
  await r.save()
  await audit(user, 'request.bill_update', 'request', r._id, { before, after: { invoiceNo: inv.invoiceNo, total: inv.total, discount: inv.discount, payable: inv.payable, paid: inv.paid, due: inv.due }, label: r.requestNo }, meta)
}

export async function removeInvoice(r: any, invoiceId: string, user: SessionUser, meta: Meta) {
  needBilling(user)
  const inv = r.billing?.invoices?.id(invoiceId)
  if (!inv) throw notFound('Invoice')
  const before = { invoiceNo: inv.invoiceNo, payable: inv.payable, paid: inv.paid }
  inv.deleteOne()
  recompute(r)
  await r.save()
  await audit(user, 'request.bill_unlink', 'request', r._id, { before, label: r.requestNo }, meta)
}

export async function setBillingStatus(r: any, status: 'PAID' | 'PARTIAL' | 'DUE' | 'WAIVED' | null, user: SessionUser, meta: Meta) {
  needBilling(user)
  const before = { status: r.billing?.status, override: r.billing?.statusOverride }
  r.set('billing.statusOverride', status ?? undefined)
  recompute(r)
  await r.save()
  await audit(user, 'request.bill_status', 'request', r._id, { before, after: { status: r.billing.status, override: status }, label: r.requestNo }, meta)
}

/** WhatsApp the chosen bill files to the patient and/or care team (as documents, from the paired number). */
export async function sendInvoices(r: any, input: z.infer<typeof SendInvoicesInput>, user: SessionUser, meta: Meta) {
  if (!can(user, 'billing.invoice') || !can(user, 'messages.send')) throw forbidden()
  if (!(await isPaired())) throw bad('WhatsApp is not paired — pair it in Settings → WhatsApp to send files')
  const list = (r.billing?.invoices ?? []).filter((x: any) => input.invoiceIds.includes(String(x._id)))
  if (!list.length) throw bad('Pick at least one invoice')
  const noFile = list.filter((x: any) => !x.attachmentId)
  if (noFile.length) throw bad(`Upload the bill file for ${noFile.map((x: any) => x.invoiceNo).join(', ')} first`)
  const team = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? []), r.transport?.driverId].filter(Boolean).map(String)
  const staffIds = input.staffIds.filter((id) => team.includes(id))
  const [patient, staff, base] = await Promise.all([
    input.patient ? Patient.findById(r.patientId).select('name phone whatsapp consent').lean<any>() : null,
    staffIds.length ? User.find({ _id: { $in: staffIds } }).select('name phone whatsapp').lean<any[]>() : [],
    templateVars(r),
  ])
  if (input.patient && patient?.consent?.whatsapp === false) throw bad('The patient opted out of WhatsApp')
  const { queueWhatsApp } = await import('../wa/service')
  const b = r.billing ?? {}
  let sent = 0
  for (const inv of list) {
    const vars = { ...base, invoiceNo: inv.invoiceNo, total: taka(inv.payable), paid: taka(inv.paid), due: taka(inv.due), date: fmtDate(inv.date) }
    const fileName = `Unico-Bill-${inv.invoiceNo}.pdf`
    if (input.patient && patient && (patient.whatsapp || patient.phone)) {
      const { text } = await renderTemplate('patient_bill', vars)
      await queueWhatsApp({ to: patient.whatsapp || patient.phone, toName: patient.name, text, templateKey: 'patient_bill', requestId: r._id, patientId: r.patientId, initiatedBy: user.id, attachmentId: inv.attachmentId, fileName })
      sent++
    }
    for (const s of staff) {
      if (!(s.whatsapp || s.phone)) continue
      const { text } = await renderTemplate('staff_bill', { ...vars, staffName: s.name })
      await queueWhatsApp({ to: s.whatsapp || s.phone, toName: s.name, text, templateKey: 'staff_bill', requestId: r._id, initiatedBy: user.id, attachmentId: inv.attachmentId, fileName })
      sent++
    }
  }
  await audit(user, 'message.whatsapp_send', 'request', r._id, { after: { invoices: list.map((x: any) => x.invoiceNo), patient: input.patient, staff: staffIds.length, sent, status: b.status }, label: r.requestNo }, meta)
  return { sent }
}
