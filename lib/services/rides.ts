import 'server-only'
import { z } from 'zod'
import { Attachment, ExpenseClaim, HomecareRequest, Patient, User } from '../models'
import { isCoordinator } from '../constants'
import { audit } from '../audit'
import { bad, forbidden, notFound } from '../api'
import { background } from '../messaging'
import { canQueue } from '../wa/status'
import { getSettings } from '../settings'
import { readFile, storeFile } from '../files'
import { fillRequisition } from '../forms/requisition'
import { date as fmtDate, dateTime, taka, time as fmtTime } from '../format'
import { draftOf } from './claims'
import { onCallSupervisors } from './transport-docs'
import type { SessionUser } from '../auth'

// Own rides (Uber / Pathao / CNG / rickshaw…) for a visit, with screenshots — added on the visit or any time later
// (staff often pay with their own money and add it after they get back). Each ride:
//   1. goes to the on-call security supervisor as one PDF: the Vehicle Requisition Form + the screenshots;
//   2. lands on the payer's conveyance claim (Bill Submission form) with the screenshots as receipts.

type Meta = { ip?: string; userAgent?: string; client?: string }
export const RIDE_MODES = ['Uber', 'Pathao', 'CNG', 'Rickshaw', 'Bus', 'Other'] as const
/** OUT hospital → patient · BACK patient → hospital · BOTH one fare for the round trip · OTHER anything else */
export const RIDE_LEGS = ['OUT', 'BACK', 'BOTH', 'OTHER'] as const
const TRANSPORT_MODE: Record<string, string> = { Uber: 'UBER', Pathao: 'PATHAO', Rickshaw: 'RICKSHAW' }

export const RideInput = z.object({
  leg: z.enum(RIDE_LEGS).default('OUT'),
  mode: z.enum(RIDE_MODES),
  amount: z.coerce.number().positive().max(100_000).optional(),
  at: z.string().optional(), // ISO; default now
  attachmentIds: z.array(z.string()).max(5).default([]),
  note: z.string().max(300).optional(),
  /** coordinator adding a ride for a team member */
  paidBy: z.string().optional(),
})

const team = (r: any) => [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean).map(String)
const legLabel = (l: string) => (l === 'OUT' ? 'To patient' : l === 'BACK' ? 'Back to hospital' : l === 'BOTH' ? 'Both ways' : 'Other trip')

/** Patient-side details shared by the PDF and the claim line. */
async function visitInfo(r: any) {
  const [s, p] = await Promise.all([getSettings(), Patient.findById(r.patientId).select('uhid address').lean<any>()])
  const hospital = s.general.hospitalName.replace(/\s+PLC$/i, '')
  const address = [p?.address?.house && `House ${p.address.house}`, r.patientSnapshot?.address].filter(Boolean).join(', ') || r.patientSnapshot?.area || ''
  return { s, hospital, address, uhid: p?.uhid ?? r.patientSnapshot?.uhid ?? '' }
}

export async function addRide(r: any, input: z.infer<typeof RideInput>, user: SessionUser, meta: Meta) {
  const members = team(r)
  const coordinator = isCoordinator(user)
  if (!members.includes(user.id) && !coordinator) throw forbidden('Only the care team or a coordinator can add rides')
  const paidBy = input.paidBy && coordinator ? input.paidBy : user.id
  if (input.paidBy && coordinator && !members.includes(paidBy) && paidBy !== user.id) throw bad('Pick someone from the care team')
  if (input.attachmentIds.length) {
    const n = await Attachment.countDocuments({ _id: { $in: input.attachmentIds }, requestId: r._id, deletedAt: null })
    if (n !== input.attachmentIds.length) throw bad('A screenshot was not found on this request')
  }
  const now = new Date()
  r.rides.push({ userId: paidBy, leg: input.leg, mode: input.mode, amount: input.amount, at: input.at ? new Date(input.at) : now, attachmentIds: input.attachmentIds, note: input.note, addedBy: user.id, addedAt: now })
  const ride = r.rides[r.rides.length - 1]
  if (!r.transport?.mode && TRANSPORT_MODE[input.mode]) r.set('transport.mode', TRANSPORT_MODE[input.mode])
  if (!r.transport?.mode && !TRANSPORT_MODE[input.mode]) r.set('transport.mode', 'OTHER')
  await r.save()
  await audit(user, 'ride.add', 'request', r._id, { after: { leg: input.leg, mode: input.mode, amount: input.amount, screenshots: input.attachmentIds.length, paidBy }, label: r.requestNo }, meta)
  const rideId = String(ride._id)
  background(async () => {
    await addRideToClaim(r._id, rideId).catch((e) => console.error('[ride → claim]', e))
    await sendRideDocs(r._id, rideId, user.id).catch((e) => console.error('[ride → security]', e))
  })
  return { id: rideId }
}

export async function removeRide(r: any, rideId: string, user: SessionUser, meta: Meta) {
  const ride = r.rides?.id(rideId)
  if (!ride) throw notFound('Ride')
  if (String(ride.userId) !== user.id && String(ride.addedBy) !== user.id && !isCoordinator(user)) throw forbidden()
  // take it off the payer's claim while that claim is still a draft
  if (ride.claimId && ride.claimLineId) await ExpenseClaim.updateOne({ _id: ride.claimId, status: 'DRAFT' }, { $pull: { lines: { _id: ride.claimLineId } } })
  if (ride.claimId) {
    const c = await ExpenseClaim.findById(ride.claimId)
    if (c && c.status === 'DRAFT') {
      c.total = c.lines.reduce((a: number, l: any) => a + (l.amount ?? 0), 0)
      await c.save()
    }
  }
  const before = { leg: ride.leg, mode: ride.mode, amount: ride.amount }
  ride.deleteOne()
  await r.save()
  await audit(user, 'ride.remove', 'request', r._id, { before, label: r.requestNo }, meta)
}

/** Put the ride on the payer's open claim (update the same leg's line if it's already there). */
export async function addRideToClaim(requestId: unknown, rideId: string) {
  const r = await HomecareRequest.findById(requestId)
  const ride = r?.rides?.id(rideId)
  if (!r || !ride || !ride.amount) return // no amount yet → nothing to claim (added when the amount is filled in)
  const payer = await User.findById(ride.userId).select('employeeId').lean<any>()
  if (!payer) return
  const { hospital, address, uhid } = await visitInfo(r)
  const c = await draftOf({ id: String(ride.userId), employeeId: payer.employeeId })
  const from = ride.leg === 'BACK' ? address : hospital
  const to = ride.leg === 'BACK' ? hospital : ride.leg === 'OUT' ? address : ride.leg === 'BOTH' ? `${address} and back` : ride.note || address
  const line = { kind: 'CONVEYANCE', requestId: r._id, leg: ride.leg === 'OTHER' ? undefined : ride.leg, at: ride.at, uhid, patientName: r.patientSnapshot?.name, invoiceNo: r.billing?.invoiceNo, from, to, mode: ride.mode, amount: ride.amount, receiptIds: ride.attachmentIds, note: ride.note }
  const existing = ride.claimLineId ? c.lines.id(ride.claimLineId) : ride.leg !== 'OTHER' ? c.lines.find((l: any) => String(l.requestId) === String(r._id) && l.leg === ride.leg) : null
  if (existing) Object.assign(existing, line)
  else c.lines.push(line)
  c.total = c.lines.reduce((a: number, l: any) => a + (l.amount ?? 0), 0)
  await c.save()
  const saved = existing ?? c.lines[c.lines.length - 1]
  await HomecareRequest.updateOne({ _id: r._id, 'rides._id': ride._id }, { $set: { 'rides.$.claimId': c._id, 'rides.$.claimLineId': saved._id } })
}

/** Requisition form for the own ride + its screenshots, as one PDF to the on-call security supervisor. */
export async function sendRideDocs(requestId: unknown, rideId: string, initiatedBy?: string) {
  const r = await HomecareRequest.findById(requestId).lean<any>()
  const ride = (r?.rides ?? []).find((x: any) => String(x._id) === rideId)
  if (!r || !ride) return { sent: 0 }
  const [{ s, hospital, address }, payer] = await Promise.all([visitInfo(r), User.findById(ride.userId).select('name employeeId designationId signatureId').lean<any>()])
  const sign = payer?.signatureId ? await readFile(payer.signatureId) : null
  const shots: { data: Buffer; mime: string; label: string }[] = []
  for (const [i, id] of (ride.attachmentIds ?? []).entries()) {
    const f = await readFile(id)
    if (f && f.mime.startsWith('image/')) shots.push({ data: f.data, mime: f.mime, label: `${legLabel(ride.leg)} · ${ride.mode}${ride.amount ? ` · ${taka(ride.amount)}` : ''} · screenshot ${i + 1}` })
  }
  const at = ride.at ? new Date(ride.at) : new Date()
  const pdf = await fillRequisition({
    requester: payer ? `${payer.name} · ID ${payer.employeeId}` : 'Home Care staff',
    designation: 'Home Care',
    requestDate: fmtDate(new Date()),
    tripDate: `${fmtDate(at)} · ${fmtTime(at)}`,
    reporting: ride.leg === 'BACK' ? `${fmtTime(at)} · patient's home` : `${fmtTime(at)} · ${hospital}`,
    destination: ride.leg === 'BACK' ? hospital : ride.leg === 'BOTH' ? `${address} and back to ${hospital}` : address,
    purpose: `Home care visit · ${(r.services ?? []).map((x: any) => x.name).join(', ')} · Patient ${r.patientSnapshot?.name ?? ''} · ${legLabel(ride.leg).toLowerCase()}`,
    passengers: '1',
    duration: ride.amount ? `Fare ${taka(ride.amount)}` : '',
    vehicleType: 'Car',
    vehicleOther: `${ride.mode} (own arrangement)`,
    ownRide: `Own ride: ${ride.mode}${ride.amount ? ` · ${taka(ride.amount)}` : ''} · ${shots.length} screenshot${shots.length === 1 ? '' : 's'} attached`,
    requesterSign: sign ? { data: sign.data, mime: sign.mime } : null,
    appendImages: shots,
    footer: `${r.requestNo} · own ride added in Unico HomeCare · ${dateTime(new Date())}`,
  })
  const file = await storeFile({ data: pdf, mime: 'application/pdf', filename: `Ride-${ride.mode}-${r.requestNo}.pdf`, kind: 'REQUISITION', requestId: r._id, uploadedBy: initiatedBy, caption: `Own ride · ${ride.mode} · ${legLabel(ride.leg)}` })
  await HomecareRequest.updateOne({ _id: r._id, 'rides._id': ride._id }, { $set: { 'rides.$.requisitionId': file._id } })
  if (!(await canQueue())) return { sent: 0, requisitionId: String(file._id) }
  const { queueWhatsApp } = await import('../wa/service')
  const caption = `Own ride · ${r.patientSnapshot?.name ?? 'home visit'}\n${ride.mode} · ${legLabel(ride.leg)}${ride.amount ? ` · ${taka(ride.amount)}` : ''}\nBy ${payer?.name ?? 'staff'} · ${fmtDate(at)} ${fmtTime(at)}`
  let sent = 0
  for (const sup of await onCallSupervisors()) {
    await queueWhatsApp({ to: sup.phone, toName: `${sup.name} (security supervisor)`, text: caption, templateKey: 'vehicle_requisition', requestId: r._id, initiatedBy, attachmentId: file._id, fileName: file.filename })
    sent++
  }
  if (sent) await HomecareRequest.updateOne({ _id: r._id, 'rides._id': ride._id }, { $set: { 'rides.$.sentAt': new Date() } })
  return { sent, requisitionId: String(file._id) }
}

export const RidePatch = z.object({ amount: z.coerce.number().positive().max(100_000).optional(), attachmentIds: z.array(z.string()).max(5).optional(), note: z.string().max(300).optional(), mode: z.enum(RIDE_MODES).optional(), leg: z.enum(RIDE_LEGS).optional() })

/** Fill in the amount / add screenshots later; the claim line and the PDF follow. */
export async function updateRide(r: any, rideId: string, patch: z.infer<typeof RidePatch>, user: SessionUser, meta: Meta) {
  const ride = r.rides?.id(rideId)
  if (!ride) throw notFound('Ride')
  if (String(ride.userId) !== user.id && String(ride.addedBy) !== user.id && !isCoordinator(user)) throw forbidden()
  if (patch.attachmentIds?.length) {
    const n = await Attachment.countDocuments({ _id: { $in: patch.attachmentIds }, requestId: r._id, deletedAt: null })
    if (n !== patch.attachmentIds.length) throw bad('A screenshot was not found on this request')
  }
  Object.assign(ride, patch)
  await r.save()
  await audit(user, 'ride.update', 'request', r._id, { after: patch, label: r.requestNo }, meta)
  background(async () => {
    await addRideToClaim(r._id, rideId).catch((e) => console.error('[ride → claim]', e))
    if (patch.attachmentIds || patch.amount != null) await sendRideDocs(r._id, rideId, user.id).catch((e) => console.error('[ride → security]', e))
  })
}
