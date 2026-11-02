import { clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { patientRoute } from '@/lib/patient-auth'
import { clearPatientPhoto, setPatientPhoto } from '@/lib/avatars'

// same actor shape as lib/services/patients-portal.ts (actorId is a staff User ref, so none here)
const actor = (p: { name: string }) => ({ id: undefined, name: `Patient portal · ${p.name}`, role: 'PATIENT' }) as any

/** POST (multipart `file`) — the signed-in patient sets their profile photo (patient portal → Profile). */
export const POST = patientRoute(async ({ req, patient }) => {
  const r = await setPatientPhoto(req, patient.id)
  await audit(actor(patient), 'patient.photo_set', 'patient', patient.id, { before: { photoUrl: r.before }, after: { photoUrl: r.url }, label: patient.name }, clientMeta(req))
  return { url: r.url }
})

export const DELETE = patientRoute(async ({ req, patient }) => {
  const r = await clearPatientPhoto(patient.id)
  await audit(actor(patient), 'patient.photo_remove', 'patient', patient.id, { before: { photoUrl: r.before }, label: patient.name }, clientMeta(req))
  return { ok: true }
})
