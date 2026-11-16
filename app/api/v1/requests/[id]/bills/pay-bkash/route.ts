import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { can } from '@/lib/constants'
import { loadRequest, isTeamMember } from '@/lib/services/requests'
import { getSettings } from '@/lib/settings'
import { waNumber } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { taka } from '@/lib/format'

const PayInput = z.object({
  /** the patient's number by default; any other number when the patient has no WhatsApp */
  to: z.string().trim().min(6).max(20),
  toName: z.string().trim().max(80).optional(),
})

/** The money still owed on this visit, from its bills (H360 or uploaded) — never an estimate. */
function owed(r: any) {
  const live = (r.billing?.invoices ?? []).filter((i: any) => !i.replacedBy)
  const due = live.reduce((a: number, i: any) => a + (Number(i.due) || 0), 0)
  const payable = live.reduce((a: number, i: any) => a + (Number(i.payable) || 0), 0)
  const fromBilling = Number(r.billing?.dueAmount) || 0
  return { due: live.length ? due : fromBilling, payable, invoices: live.filter((i: any) => (Number(i.due) || 0) > 0).map((i: any) => ({ no: i.invoiceNo, due: Number(i.due) || 0 })) }
}

/** GET /api/v1/requests/:id/bills/pay-bkash — what would be asked for: the amount due and the bills it comes from. */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  const b = (await getSettings()).payments.bkash
  const o = owed(r)
  return { enabled: !!b.enabled && !!b.qrAttachmentId, merchantNumber: b.merchantNumber || null, ...o, patientPhone: r.patientSnapshot?.phone ?? null, patientName: r.patientSnapshot?.name ?? null, requesterPhone: r.requester?.phone ?? null, requesterName: r.requester?.name ?? null }
})

/**
 * POST /api/v1/requests/:id/bills/pay-bkash { to, toName? } — send the patient (or the number given) the amount due on
 * this visit's bills and the hospital's own bKash QR picture, on WhatsApp from the hospital number, at once.
 * Only with a real bill: nothing is sent when nothing is due.
 */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  if (!can(user, 'billing.invoice') && !isTeamMember(user, r)) throw forbidden('Only billing staff or the care team can send payment details')
  const input = await body(req, PayInput)
  const b = (await getSettings()).payments.bkash
  if (!b.enabled || !b.qrAttachmentId) throw bad('bKash payment is not set up yet (Settings → Payments: upload the QR picture)')
  const to = waNumber(input.to)
  if (!to) throw bad('Enter a valid mobile number')
  const o = owed(r)
  if (!(o.due > 0)) throw bad('Nothing is due on this visit. Add the bill (H360 invoice) first.')
  const p = r.patientSnapshot ?? {}
  const text = [
    `Unico Home Care · Payment`,
    `Patient: ${p.name ?? ''}${p.uhid ? ` (UHID ${p.uhid})` : ''}`,
    `Visit: ${r.requestNo}`,
    ...(o.invoices.length ? o.invoices.map((i: { no: string; due: number }) => `Invoice ${i.no}: ${taka(i.due)}`) : []),
    `*Amount to pay: ${taka(o.due)}*`,
    ``,
    `Pay with bKash or any bank app: scan the QR in this message (Bangla QR)${b.merchantNumber ? `, merchant ${b.merchantNumber}` : ''}.`,
    `Please pay exactly ${taka(o.due)} and send us the transaction ID (TrxID) after paying.`,
  ].join('\n')
  const { queueWhatsApp } = await import('@/lib/wa/service')
  const log = await queueWhatsApp({ to, toName: input.toName ?? (waNumber(p.phone) === to ? p.name : undefined), text, templateKey: 'BKASH_PAYMENT', requestId: r._id, patientId: r.patientId, initiatedBy: user.id, attachmentId: b.qrAttachmentId, fileName: 'bkash-qr.png', priority: 90, approved: true })
  await audit(user, 'request.payment_request', 'request', r._id, { after: { to, amount: o.due, invoices: o.invoices.map((i: any) => i.no), status: log.status }, label: r.requestNo }, clientMeta(req, user))
  return { ok: log.status !== 'SKIPPED', status: log.status, skipped: log.status === 'SKIPPED' ? log.error ?? 'Not sent' : null, amount: o.due, to, text }
})
