import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { requireAppUser, type SessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { DESK_ROLES, type Permission } from '@/lib/constants'
import { HomecareRequest, Patient, isOid } from '@/lib/models'
import { canView, withPeople, slaInfo } from '@/lib/services/requests'
import { getSettings } from '@/lib/settings'

/** Admin tab screens: HC_ADMIN, FRONT_DESK, SUPER_ADMIN (+ optional permission). */
export async function requireDesk(perm: Permission = 'requests.create'): Promise<SessionUser> {
  const u = await requireAppUser(perm)
  if (!DESK_ROLES.includes(u.role)) redirect('/m?denied=1')
  await db()
  return u
}

/** One request for coordinator screens: lean, people joined, SLA and patient attached. 404 when missing / not visible. */
export async function loadCoordRequest(id: string, user: SessionUser) {
  if (!isOid(id)) notFound()
  const r = await HomecareRequest.findOne({ _id: id, deletedAt: null }).lean<any>()
  if (!r || !canView(user, r)) notFound()
  await withPeople([r])
  const settings = await getSettings()
  r.sla = slaInfo(r, settings)
  const patient = await Patient.findById(r.patientId).lean<any>()
  return { r, patient, settings }
}

/** Dhaka "YYYY-MM-DD" + "HH:mm" parts of a date for form defaults */
export function dhakaParts(d?: Date | string | null) {
  if (!d) return { date: '', time: '' }
  const x = new Date(d)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(x)
  return { date, time }
}
