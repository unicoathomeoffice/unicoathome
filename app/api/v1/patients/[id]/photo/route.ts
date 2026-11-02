import { route, clientMeta, forbidden, notFound } from '@/lib/api'
import { audit } from '@/lib/audit'
import { can } from '@/lib/constants'
import { isOid } from '@/lib/models'
import { clearPatientPhoto, setPatientPhoto } from '@/lib/avatars'

/** POST (multipart `file`) — staff set a patient's profile photo (patient record page). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'patients.edit')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Patient')
  const r = await setPatientPhoto(req, params.id, user.id)
  await audit(user, 'patient.photo_set', 'patient', params.id, { before: { photoUrl: r.before }, after: { photoUrl: r.url } }, clientMeta(req, user))
  return { url: r.url }
})

export const DELETE = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'patients.edit')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Patient')
  const r = await clearPatientPhoto(params.id)
  await audit(user, 'patient.photo_remove', 'patient', params.id, { before: { photoUrl: r.before } }, clientMeta(req, user))
  return { ok: true }
})
