import { route, forbidden, notFound, bad } from '@/lib/api'
import { can } from '@/lib/constants'
import { isOid, Patient } from '@/lib/models'
import { syncPatientFromH360 } from '@/lib/h360-patient'
import { H360Error } from '@/lib/h360'

/** POST — refresh this patient's profile from H360 now (by UHID). */
export const POST = route<{ id: string }>(async ({ user, params }) => {
  if (!can(user, 'patients.edit') && !can(user, 'requests.manage')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Patient')
  const p = await Patient.findById(params.id).select('uhid').lean<any>()
  if (!p) throw notFound('Patient')
  if (!p.uhid) throw bad('Add the patient’s UHID first')
  try {
    const r = await syncPatientFromH360(params.id, user)
    if (!r.found) throw bad(`UHID ${p.uhid} was not found in H360`)
    return r
  } catch (e) {
    if (e instanceof H360Error) throw bad(e.code === 'AUTH' ? 'H360 sign-in failed — check Settings → Integrations' : 'H360 is not answering right now')
    throw e
  }
})
