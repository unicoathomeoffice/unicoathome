import 'server-only'
import { z } from 'zod'
import { HomecareRequest, Patient } from '../models'
import { VITALS } from '../constants'
import { getSettings } from '../settings'
import { renderTemplate, waNumber } from '../messaging'
import { isPaired } from '../wa/status'
import { ageGender, date as fmtDate, taka, time as fmtTime } from '../format'
import { bad } from '../api'
import { withPeople } from './requests'

// Short visit update, generated from what the team recorded (times, vitals, checklist, meds, bill) — no typing.
// Sent automatically on WhatsApp when the team is back at the hospital (or at completion when there is no return
// trip), and on demand from the request page. Template 'visit_update' wraps the generated {summary}.

const fmtV = (k: string, v: number) => (k === 'tempC' ? `${v}°C` : k === 'spo2' ? `${v}%` : String(v))
const LABEL: Record<string, string> = { bpSys: 'BP', pulse: 'Pulse', tempC: 'Temp', spo2: 'SpO₂', rbs: 'RBS', painScore: 'Pain', weightKg: 'Wt' }

/** Plain-text summary of one visit (WhatsApp-friendly, one fact per line, lines without data left out). */
export async function buildVisitUpdate(requestId: unknown, opts: { forPatient?: boolean } = {}) {
  const r = await HomecareRequest.findById(requestId).lean<any>()
  if (!r) throw bad('Request not found')
  await withPeople([r])
  const t = r.timeline ?? {}
  const v = r.visit ?? {}
  const vit = v.vitals ?? {}
  const lines: string[] = []
  const services = (r.services ?? []).map((s: any) => s.name).join(', ')
  if (opts.forPatient) {
    lines.push(`Dear ${r.patientSnapshot?.name}, here is a summary of today's home visit (${r.requestNo}).`)
  } else {
    lines.push(`${['COMPLETED', 'CLOSED'].includes(r.status) ? '✅' : 'ℹ️'} ${r.requestNo} · ${services}`)
    lines.push(`Patient: ${r.patientSnapshot?.name}${r.patientSnapshot?.ageYears != null ? ` (${ageGender(r.patientSnapshot.ageYears, r.patientSnapshot.gender)})` : ''}${r.patientSnapshot?.area ? ` · ${r.patientSnapshot.area}` : ''}`)
  }
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  if (team.length) lines.push(`${opts.forPatient ? 'Seen by' : 'Team'}: ${team.map((p: any) => `${p.name}${p.designation ? ` (${p.designation})` : ''}`).join(', ')}`)

  if (!opts.forPatient) {
    const times: string[] = []
    if (t.enRouteAt) times.push(`Left ${fmtTime(t.enRouteAt)}`)
    if (t.checkInAt) times.push(`Arrived ${fmtTime(t.checkInAt)}${v.lateMin > 0 ? ` (+${v.lateMin} min late)` : ''}`)
    if (t.checkInAt && t.checkOutAt) times.push(`Visit ${fmtTime(t.checkInAt)}–${fmtTime(t.checkOutAt)} (${v.durationMin ?? 0} min)`)
    if (r.returnTrip?.reachedAt) times.push(`Back ${fmtTime(r.returnTrip.reachedAt)}`)
    if (times.length) lines.push(times.join(' · '))
    if (t.enRouteAt && r.returnTrip?.reachedAt) lines.push(`Total time out: ${Math.round((+new Date(r.returnTrip.reachedAt) - +new Date(t.enRouteAt)) / 60000)} min`)
  } else if (t.checkInAt) {
    lines.push(`Date: ${fmtDate(t.checkInAt)} · ${fmtTime(t.checkInAt)}${t.checkOutAt ? `–${fmtTime(t.checkOutAt)}` : ''}`)
  }

  // vitals: BP as one value, out-of-range values marked
  const vs: string[] = []
  const flag = (k: string, val: number) => {
    const d = VITALS.find((x) => x.key === k)
    return d && (val < d.min || val > d.max) ? ' ⚠' : ''
  }
  if (vit.bpSys != null && vit.bpDia != null) vs.push(`BP ${vit.bpSys}/${vit.bpDia}${flag('bpSys', vit.bpSys) || flag('bpDia', vit.bpDia)}`)
  for (const k of ['pulse', 'spo2', 'tempC', 'rbs', 'painScore'] as const) if (vit[k] != null) vs.push(`${LABEL[k]} ${fmtV(k, vit[k])}${opts.forPatient ? '' : flag(k, vit[k])}`)
  if (vs.length) lines.push(`Vitals: ${vs.join(' · ')}`)

  if (!opts.forPatient) {
    const ck = v.checklist ?? []
    if (ck.length) lines.push(`Checklist ${ck.filter((c: any) => c.done).length}/${ck.length}`)
  }
  const meds = (v.medications ?? []).map((m: any) => [m.drug, m.dose].filter(Boolean).join(' ')).filter(Boolean)
  if (meds.length) lines.push(`${opts.forPatient ? 'Medicines given' : 'Meds given'}: ${meds.join(', ')}`)
  if (r.tests?.length) lines.push(`Tests: ${r.tests.join(', ')}`)
  const note = opts.forPatient ? v.remarks : v.notes?.clinical || v.remarks
  if (note) lines.push(`${opts.forPatient ? 'Advice' : 'Note'}: ${String(note).slice(0, 200)}`)

  if (!opts.forPatient) {
    const b = r.billing ?? {}
    const amount = b.invoiceAmount ?? b.billAmount ?? b.estimatedFee
    if (amount != null) lines.push(`Bill: ${taka(amount)}${b.status ? ` · ${b.status === 'PARTIAL' ? 'Partially paid' : b.status[0] + b.status.slice(1).toLowerCase()}` : ''}${b.invoiceNo ? ` (#${b.invoiceNo})` : ''}`)
  }
  // next visit from the same care plan, if one is booked
  const next = await HomecareRequest.findOne({ patientId: r.patientId, _id: { $ne: r._id }, deletedAt: null, status: { $nin: ['CANCELLED', 'COMPLETED', 'CLOSED'] }, scheduledAt: { $gt: new Date() } })
    .sort({ scheduledAt: 1 })
    .select('scheduledAt services')
    .lean<any>()
  if (next) lines.push(`Next: ${(next.services ?? []).map((s: any) => s.name).join(', ')} ${fmtDate(next.scheduledAt)} ${fmtTime(next.scheduledAt)}`)
  return { r, text: lines.join('\n') }
}

type Recipient = { name: string; phone: string; kind: 'hod' | 'extra' | 'staff' | 'patient' }

/** Who gets the automatic update: HODs of the visit's service categories + the extra numbers (+ the patient). */
async function defaultRecipients(r: any): Promise<Recipient[]> {
  const s = await getSettings()
  const cfg = s.visitUpdates
  const out: Recipient[] = []
  if (cfg.toHods) {
    const { hodRecipients } = await import('./hod')
    for (const c of await hodRecipients(r)) out.push({ name: `${c.name} (${c.designation})`, phone: c.phone, kind: 'hod' })
  }
  for (const e of cfg.extra ?? []) out.push({ name: e.name, phone: e.phone, kind: 'extra' })
  return out
}

/**
 * Send the update. 'auto' (back at hospital / completion): once per visit, to the configured recipients.
 * 'manual' (request page): to the chosen recipients, any number of times.
 */
export async function sendVisitUpdate(requestId: unknown, mode: 'auto' | 'manual', pick?: { hods?: boolean; extra?: boolean; staff?: boolean; patient?: boolean }, initiatedBy?: string) {
  const s = await getSettings()
  if (mode === 'auto') {
    if (!s.visitUpdates.enabled) return { sent: 0 }
    // claim the one automatic send atomically (two triggers can race: geofence ping + button)
    const claimed = await HomecareRequest.updateOne({ _id: requestId, 'visit.updateSentAt': null }, { $set: { 'visit.updateSentAt': new Date() } })
    if (!claimed.modifiedCount) return { sent: 0 }
  }
  if (!(await isPaired())) {
    if (mode === 'manual') throw bad('WhatsApp is not paired — pair it in Settings → WhatsApp first')
    return { sent: 0 }
  }
  const { r, text: summary } = await buildVisitUpdate(requestId)
  const all = await defaultRecipients(r)
  const to: Recipient[] =
    mode === 'auto'
      ? all
      : [
          ...(pick?.hods ? all.filter((x) => x.kind === 'hod') : []),
          ...(pick?.extra ? all.filter((x) => x.kind === 'extra') : []),
          ...(pick?.staff ? [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter((p: any) => p?.phone).map((p: any) => ({ name: p.name, phone: p.phone, kind: 'staff' as const })) : []),
        ]
  const { queueWhatsApp } = await import('../wa/service')
  const seen = new Set<string>()
  let sent = 0
  const vars = { requestNo: r.requestNo, patientName: r.patientSnapshot?.name, summary }
  for (const x of to) {
    const n = waNumber(x.phone)
    if (!n || seen.has(n)) continue
    seen.add(n)
    const { text } = await renderTemplate('visit_update', vars)
    await queueWhatsApp({ to: x.phone, toName: x.name, text, templateKey: 'visit_update', requestId: r._id, initiatedBy })
    sent++
  }
  const toPatient = mode === 'auto' ? s.visitUpdates.toPatient : !!pick?.patient
  if (toPatient) {
    const p = await Patient.findById(r.patientId).select('name phone whatsapp consent').lean<any>()
    if (p && p.consent?.whatsapp !== false && (p.whatsapp || p.phone)) {
      const { text: patientSummary } = await buildVisitUpdate(requestId, { forPatient: true })
      const { text } = await renderTemplate('patient_visit_summary', { ...vars, summary: patientSummary, hospitalPhone: s.general.hospitalPhone })
      await queueWhatsApp({ to: p.whatsapp || p.phone, toName: p.name, text, templateKey: 'patient_visit_summary', requestId: r._id, patientId: r.patientId, initiatedBy })
      sent++
    }
  }
  return { sent }
}

export const SendUpdateInput = z.object({ hods: z.boolean().optional(), extra: z.boolean().optional(), staff: z.boolean().optional(), patient: z.boolean().optional() })
