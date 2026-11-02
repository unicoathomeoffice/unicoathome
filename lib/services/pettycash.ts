import 'server-only'
import { z } from 'zod'
import { Designation, HomecareRequest, Patient, User, isOid } from '../models'
import { bad, forbidden, notFound } from '../api'
import { audit, type Meta } from '../audit'
import { can, TRANSPORT_MODE_LABEL } from '../constants'
import { background, notifyUsers, renderTemplate, waNumber } from '../messaging'
import { isPaired } from '../wa/status'
import { getSettings } from '../settings'
import { readFile, storeFile } from '../files'
import { date as fmtDate, time as fmtTime, taka } from '../format'
import { makePettyCashVoucher } from '../forms/pettycash'
import type { SessionUser } from '../auth'

// No hospital car free → the team goes by Uber / Pathao / CNG and a coordinator gives petty cash on the spot (request page
// → Car & driver → "Car not available"). Approved at once, so it never blocks closing. A voucher PDF is made and sent
// on WhatsApp to the staff member and the cash counter; the Security / Transport groups hear that no car is going.

export const OWN_MODES = ['UBER', 'PATHAO', 'CNG', 'RICKSHAW', 'OTHER'] as const
export const OwnTransportInput = z.object({
  mode: z.enum(OWN_MODES),
  amount: z.coerce.number().int().min(1, 'Enter the amount').max(50000),
  forUserId: z.string().refine(isOid, 'Pick the staff member'),
  purpose: z.string().trim().min(2).max(200),
  note: z.string().trim().max(300).optional(),
})

const modeLabel = (m?: string) => (m ? (TRANSPORT_MODE_LABEL as Record<string, string>)[m] ?? m : '')

export async function giveOwnTransportCash(r: any, input: z.infer<typeof OwnTransportInput>, user: SessionUser, meta: Meta) {
  if (!can(user, 'transport.manage') && !can(user, 'requests.override')) throw forbidden()
  if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)) throw bad('The visit is already finished')
  const team = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean).map(String)
  if (!team.includes(input.forUserId)) throw bad('Petty cash goes to someone on the visit team')

  // own transport (clears any car / driver), same path as the field app's "Own transport"
  const { assignTransport } = await import('./requests')
  await assignTransport(r, { mode: input.mode }, user, meta)

  const n = (r.pettyCash ?? []).filter((p: any) => p.voucherNo).length + 1
  const voucherNo = `PC-${String(r.requestNo).replace(/^HC-/, '')}${n > 1 ? `-${n}` : ''}`
  const now = new Date()
  const fresh = await HomecareRequest.findById(r._id)
  if (!fresh) throw notFound('Request')
  fresh.pettyCash.push({ amount: input.amount, purpose: input.purpose, note: input.note, mode: input.mode, voucherNo, requestedBy: input.forUserId, requestedAt: now, status: 'APPROVED', decidedBy: user.id, decidedAt: now })
  await fresh.save()
  const entryId = fresh.pettyCash[fresh.pettyCash.length - 1]._id
  await audit(user, 'petty_cash.give', 'request', r._id, { after: { amount: input.amount, mode: input.mode, to: input.forUserId, voucherNo }, label: r.requestNo }, meta)

  background(() => sendVoucher(fresh._id, entryId, user))
  return { voucherNo, entryId: String(entryId) }
}

/** Make the voucher PDF and send it: staff + cash counter (with the PDF), Security / Transport groups (text). */
async function sendVoucher(requestId: unknown, entryId: unknown, user: SessionUser) {
  const r = await HomecareRequest.findById(requestId).lean<any>()
  const pc = r?.pettyCash?.find((p: any) => String(p._id) === String(entryId))
  if (!r || !pc) return
  const s = await getSettings()
  const [staff, approver, patient] = await Promise.all([
    User.findById(pc.requestedBy).select('name employeeId phone whatsapp designationId').lean<any>(),
    User.findById(user.id).select('name employeeId designationId signatureId').lean<any>(),
    Patient.findById(r.patientId).select('address').lean<any>(),
  ])
  const [staffDesig, approverDesig] = await Promise.all([
    staff?.designationId ? Designation.findById(staff.designationId).select('title').lean<any>() : null,
    approver?.designationId ? Designation.findById(approver.designationId).select('title').lean<any>() : null,
  ])
  const sign = approver?.signatureId ? await readFile(approver.signatureId) : null
  const destination = [patient?.address?.house && `House ${patient.address.house}`, patient?.address?.flat && `Flat ${patient.address.flat}`, r.patientSnapshot?.address].filter(Boolean).join(', ') || r.patientSnapshot?.area || ''
  const at = new Date(pc.decidedAt ?? Date.now())
  const pdf = await makePettyCashVoucher({
    no: pc.voucherNo,
    date: `${fmtDate(at)} · ${fmtTime(at)}`,
    paidTo: staff ? `${staff.name} · ID ${staff.employeeId}` : 'Home Care staff',
    designation: staffDesig?.title ?? 'Home Care',
    amount: pc.amount,
    purpose: pc.purpose,
    mode: modeLabel(pc.mode),
    destination,
    approvedBy: approver ? `${approver.name}${approverDesig?.title ? ` · ${approverDesig.title}` : ''}` : user.name,
    approvedSign: sign ? { data: sign.data, mime: sign.mime } : null,
    hospital: { name: s.general.hospitalName, address: s.general.address, phone: s.general.hospitalPhone },
    footer: `${r.requestNo} · generated by Unico HomeCare · ${fmtDate(new Date())} ${fmtTime(new Date())}`,
  })
  const file = await storeFile({ data: pdf, mime: 'application/pdf', filename: `Petty-Cash-${pc.voucherNo}.pdf`, kind: 'VOUCHER', requestId: r._id, uploadedBy: user.id, caption: `Petty cash voucher ${pc.voucherNo} · ${taka(pc.amount)}` })
  await HomecareRequest.updateOne({ _id: r._id, 'pettyCash._id': pc._id }, { $set: { 'pettyCash.$.voucherId': file._id } })

  const cash = (s.transportDocs as any)?.pettyCash ?? {}
  await notifyUsers([pc.requestedBy], { type: 'APPROVAL', as: 'STAFF', event: 'PETTY_CASH', title: `Petty cash ${taka(pc.amount)} approved`, body: `${modeLabel(pc.mode)} · collect from ${cash.name || 'the cash counter'}`, requestId: r._id, url: `/m/visits/${r._id}` })

  if (!(await isPaired())) return
  const { queueWhatsApp } = await import('../wa/service')
  const { templateVars } = await import('./requests')
  const vars = { ...(await templateVars(r, pc.requestedBy)), transportMode: modeLabel(pc.mode), amount: taka(pc.amount), cashCounter: cash.name || 'the cash counter' }
  const sent = new Set<string>()
  const staffPhone = staff?.whatsapp || staff?.phone
  if (staffPhone) {
    const t = await renderTemplate('petty_cash', vars)
    if (t.active) {
      await queueWhatsApp({ to: staffPhone, toName: `${staff.name} (petty cash)`, text: t.text, templateKey: 'petty_cash', requestId: r._id, initiatedBy: user.id, attachmentId: file._id, fileName: file.filename })
      sent.add(waNumber(staffPhone) ?? '')
    }
  }
  if (cash.phone && !sent.has(waNumber(cash.phone) ?? '')) {
    const caption = `Petty cash voucher ${pc.voucherNo}\n${taka(pc.amount)} to ${staff?.name ?? 'staff'} (ID ${staff?.employeeId ?? '—'})\n${modeLabel(pc.mode)} · ${r.patientSnapshot?.area ?? ''}\nApproved by ${approver?.name ?? user.name}`
    await queueWhatsApp({ to: cash.phone, toName: `${cash.name || 'Cash counter'} (petty cash)`, text: caption, templateKey: 'petty_cash', requestId: r._id, initiatedBy: user.id, attachmentId: file._id, fileName: file.filename })
  }
  const { carAlert } = await import('./hod')
  await carAlert('CAR_OWN', r._id, { amount: taka(pc.amount) }).catch((e) => console.error('[car own alert]', e))
}
