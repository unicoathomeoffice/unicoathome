import 'server-only'
import { Department, Designation, HomecareRequest, Patient, User, Vehicle } from '../models'
import { getSettings } from '../settings'
import { queueEmail, waNumber } from '../messaging'
import { isPaired } from '../wa/status'
import { readFile, storeFile } from '../files'
import { fillRequisition } from '../forms/requisition'
import { makeGatePass } from '../forms/gatepass'
import { date as fmtDate, dateTime, time as fmtTime } from '../format'
import { withPeople } from './requests'

// Unico car paperwork. As soon as a car is requested the hospital's Vehicle Requisition Form (Annex-3) is filled
// (Section A) and sent on WhatsApp to the on-call security supervisor. When the transport section allots a car,
// Section B is added and a gate pass is made; both go to the supervisor, the gate pass also to the driver.
// E-signatures are stamped only for the person who did that step (and the approver only if they allowed it).

type Sign = { data: Buffer; mime: string } | null

async function signatureOf(userId: unknown): Promise<Sign> {
  if (!userId) return null
  const u = await User.findById(userId).select('signatureId').lean<any>()
  if (!u?.signatureId) return null
  const f = await readFile(u.signatureId)
  return f ? { data: f.data, mime: f.mime } : null
}

async function person(userId: unknown) {
  if (!userId) return null
  const u = await User.findById(userId).select('name employeeId designationId departmentId phone whatsapp').lean<any>()
  if (!u) return null
  const [d, dep] = await Promise.all([
    u.designationId ? Designation.findById(u.designationId).select('title departmentId').lean<any>() : null,
    u.departmentId ? Department.findById(u.departmentId).select('name').lean<any>() : null,
  ])
  const dept = dep ?? (d?.departmentId ? await Department.findById(d.departmentId).select('name').lean<any>() : null)
  return { id: String(u._id), name: u.name as string, employeeId: u.employeeId as string, designation: d?.title as string | undefined, department: dept?.name as string | undefined, phone: (u.whatsapp || u.phone) as string | undefined }
}

const hm = (d?: Date | null) => (d ? fmtTime(d) : '')
const inShift = (from: string, to: string, at: Date) => {
  if (!from || !to) return true
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  return from <= to ? t >= from && t < to : t >= from || t < to // night shift crosses midnight
}

/** The security supervisors on call right now (all active ones when nobody's shift matches). */
export async function onCallSupervisors(at = new Date()) {
  const list = (await getSettings()).transportDocs.supervisors.filter((s) => s.active && waNumber(s.phone))
  const now = list.filter((s) => inShift(s.from, s.to, at))
  return now.length ? now : list
}

/** Build the requisition (and gate pass once a car is allotted), store them on the request and send them. */
export async function sendTransportDocs(requestId: unknown, stage: 'requested' | 'updated' | 'allotted', initiatedBy?: string) {
  const s = await getSettings()
  const cfg = s.transportDocs
  const r = await HomecareRequest.findById(requestId).lean<any>()
  if (!r || !r.transport?.needed || r.status === 'CANCELLED') return { sent: 0 }
  if (r.transport.mode && r.transport.mode !== 'UNICO_CAR') return { sent: 0 } // own transport: no car paperwork
  await withPeople([r])
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const [requester, allotter, patient, vehicle] = await Promise.all([
    person(r.transport.requestedBy ?? r.createdBy),
    person(r.transport.assignedBy),
    Patient.findById(r.patientId).select('address').lean<any>(),
    r.transport.vehicleId ? Vehicle.findById(r.transport.vehicleId).lean<any>() : null,
  ])
  const approver = cfg.approverId ? await User.findById(cfg.approverId).select('autoSignApprover').lean<any>() : null
  // Section A names the primary assigned staff (who travels); before assignment, whoever asked for the car.
  // Their e-signature is only stamped when they asked for the car themselves (signatures are for own actions).
  const lead = r.primaryStaff ?? requester
  const [requesterSign, headSign, allotterSign] = await Promise.all([
    lead && requester && lead.id === requester.id ? signatureOf(lead.id) : null,
    approver?.autoSignApprover ? signatureOf(cfg.approverId) : null,
    signatureOf(allotter?.id),
  ])
  const visit = r.scheduledAt ? new Date(r.scheduledAt) : null
  const pickup = r.transport.pickupAt ? new Date(r.transport.pickupAt) : visit ? new Date(visit.getTime() - 40 * 60_000) : null
  const back = r.transport.returnAt ? new Date(r.transport.returnAt) : visit ? new Date(visit.getTime() + ((r.expectedDurationMin ?? 45) + 60) * 60_000) : null
  const hours = pickup && back ? Math.max(1, Math.round(((back.getTime() - pickup.getTime()) / 3600_000) * 2) / 2) : null
  const address = [patient?.address?.house && `House ${patient.address.house}`, patient?.address?.flat && `Flat ${patient.address.flat}`, r.patientSnapshot?.address].filter(Boolean).join(', ')
  const allotted = stage === 'allotted' && !!vehicle
  const now = new Date()

  const pdf = await fillRequisition({
    requester: lead ? `${lead.name} · ID ${lead.employeeId}` : 'Unico @ Home coordinator',
    designation: [lead?.designation, (lead as any)?.department ?? 'Home Care'].filter(Boolean).join(' · '),
    requestDate: fmtDate(now),
    tripDate: visit ? fmtDate(visit) : 'To be confirmed',
    reporting: `${pickup ? hm(pickup) : 'Time to be confirmed'} · ${s.general.hospitalName}, ${s.general.address}`,
    destination: address || r.patientSnapshot?.area || '',
    purpose: `Home care visit · ${(r.services ?? []).map((x: any) => x.name).join(', ')} · Patient ${r.patientSnapshot?.name ?? ''}`,
    passengers: team.length ? `${team.length} (${team.map((p: any) => p.name).join(', ')})` : '1',
    duration: hours ? `About ${hours} h · return by ${hm(back)}` : '',
    vehicleType: cfg.vehicleType ?? 'Car',
    requesterSign,
    headSign,
    office: allotted ? { available: true, vehicleNo: [vehicle.plate, vehicle.name ?? vehicle.model].filter(Boolean).join(' · '), driver: [r.driver?.name, r.driver?.phone].filter(Boolean).join(' · '), allottedBy: allotter ? `${allotter.name} · ID ${allotter.employeeId}` : '', headSign: allotterSign } : null,
    footer: `${r.requestNo} · generated by Unico HomeCare · ${dateTime(now)}`,
    updated: stage === 'updated',
  })
  const reqFile = await storeFile({ data: pdf, mime: 'application/pdf', filename: `Vehicle-Requisition-${r.requestNo}.pdf`, kind: 'REQUISITION', requestId: r._id, uploadedBy: initiatedBy, caption: `Vehicle requisition (${stage})` })
  const set: Record<string, unknown> = { 'transport.requisitionId': reqFile._id, 'transport.requisitionSentAt': now }

  let gate: any = null
  if (allotted) {
    const gp = await makeGatePass({
      no: `GP-${r.requestNo}`,
      date: visit ? fmtDate(visit) : fmtDate(now),
      vehicle: [vehicle.plate, vehicle.name ?? vehicle.model].filter(Boolean).join(' · '),
      driver: r.driver?.name ?? '',
      staff: team.map((p: any) => `${p.name}${p.designation ? ` (${p.designation})` : ''}`),
      outTime: hm(pickup),
      returnTime: hm(back),
      destination: address || r.patientSnapshot?.area || '',
      purpose: `Home care visit · ${(r.services ?? []).map((x: any) => x.name).join(', ')}`,
      issuedBy: allotter ? `${allotter.name}${allotter.designation ? ` · ${allotter.designation}` : ''}` : 'Transport section',
      issuedSign: allotterSign,
      hospital: { name: s.general.hospitalName, address: s.general.address, phone: s.general.hospitalPhone },
      footer: `${r.requestNo} · generated by Unico HomeCare · ${dateTime(now)}`,
    })
    gate = await storeFile({ data: gp, mime: 'application/pdf', filename: `Gate-Pass-${r.requestNo}.pdf`, kind: 'GATE_PASS', requestId: r._id, uploadedBy: initiatedBy, caption: 'Vehicle gate pass' })
    set['transport.gatePassId'] = gate._id
  }
  await HomecareRequest.updateOne({ _id: r._id }, { $set: set })

  // ---- send
  const wantReq = cfg.sendRequisition !== false
  const wantGate = !!gate && cfg.sendGatePass !== false
  let sent = 0
  const when = visit ? `${fmtDate(visit)} · pickup ${hm(pickup)}` : 'date to be confirmed'
  const caption =
    stage === 'allotted'
      ? `Unico @ Home car allotted · ${r.requestNo}\n${when}\nVehicle ${vehicle?.plate ?? ''} · driver ${r.driver?.name ?? ''}\nTo: ${r.patientSnapshot?.area ?? ''}`
      : `${stage === 'updated' ? 'UPDATED · ' : ''}Unico @ Home car requested · ${r.requestNo}\n${when}\nTo: ${address || r.patientSnapshot?.area || ''}\nRequested by ${requester?.name ?? 'Home Care'}`
  if ((await isPaired()) && (wantReq || wantGate)) {
    const { queueWhatsApp } = await import('../wa/service')
    // on-call security supervisors + everyone in an alert group that takes the car paperwork (Security / Transport)
    const { groupRecipients } = await import('./hod')
    const docTo = [...(await onCallSupervisors()).map((x) => ({ name: x.name, phone: x.phone, role: 'security supervisor' })), ...(await groupRecipients('CAR_DOCS')).map((x) => ({ name: x.name, phone: x.phone, role: x.group.name }))]
    const seenDoc = new Set<string>()
    for (const sup of docTo.filter((x) => { const n = waNumber(x.phone); return !!n && !seenDoc.has(n) && !!seenDoc.add(n) })) {
      if (wantReq) {
        await queueWhatsApp({ to: sup.phone, toName: `${sup.name} (${sup.role})`, text: caption, templateKey: 'vehicle_requisition', requestId: r._id, initiatedBy, attachmentId: reqFile._id, fileName: reqFile.filename })
        sent++
      }
      if (wantGate) {
        await queueWhatsApp({ to: sup.phone, toName: `${sup.name} (${sup.role})`, text: `Gate pass · ${r.requestNo}`, templateKey: 'gate_pass', requestId: r._id, initiatedBy, attachmentId: gate._id, fileName: gate.filename })
        sent++
      }
    }
    if (wantGate && r.driver?.phone) {
      await queueWhatsApp({ to: r.driver.phone, toName: `${r.driver.name} (driver)`, text: `Gate pass · ${r.requestNo} · ${when}`, templateKey: 'gate_pass', requestId: r._id, initiatedBy, attachmentId: gate._id, fileName: gate.filename })
      sent++
    }
  }
  if (cfg.emailCopy && wantReq) {
    await queueEmail({ to: cfg.emailCopy, subject: `Vehicle requisition · ${r.requestNo}${stage === 'updated' ? ' (updated)' : ''}`, text: caption, templateKey: 'vehicle_requisition', requestId: r._id, initiatedBy, attachmentId: reqFile._id, fileName: reqFile.filename })
  }
  return { sent, requisitionId: String(reqFile._id), gatePassId: gate ? String(gate._id) : null }
}

/** Hook for every place a Unico car can be asked for: sends the requisition the first time (or "UPDATED"). */
export async function carRequested(requestId: unknown, userId: string, opts: { updated?: boolean } = {}): Promise<boolean> {
  const r = await HomecareRequest.findById(requestId).select('transport status').lean<any>()
  if (!r?.transport?.needed || r.status === 'CANCELLED') return false
  if (r.transport.mode && r.transport.mode !== 'UNICO_CAR') return false
  if (!r.transport.requestedBy) await HomecareRequest.updateOne({ _id: requestId }, { $set: { 'transport.requestedBy': userId } })
  if (!opts.updated) {
    // claim the first requisition atomically: creating and confirming a request in one go both call this at the
    // same moment, and a plain "not sent yet?" check let both through (two identical PDFs, two alerts)
    const claim = await HomecareRequest.updateOne({ _id: requestId, 'transport.requisitionSentAt': null }, { $set: { 'transport.requisitionSentAt': new Date() } })
    if (!claim.modifiedCount) return false
  }
  await sendTransportDocs(requestId, opts.updated ? 'updated' : 'requested', userId)
  return true // a new (or updated) car request
}
