import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { db, plain } from '@/lib/db'
import { requireAppUser, type SessionUser } from '@/lib/auth'
import { Attachment, HomecareRequest, Patient, User, isOid } from '@/lib/models'
import { canView, isTeamMember, withPeople, slaInfo } from '@/lib/services/requests'
import { getSettings } from '@/lib/settings'
import { DESK_ROLES, type Role } from '@/lib/constants'

/** Roles that see every visit in the field app (the "Admin" tab roles). */
export const isDesk = (role: string) => DESK_ROLES.includes(role as Role)

/** Mongo filter: visits where the user is on the care team (primary or secondary). */
export function teamFilter(user: SessionUser) {
  return { $or: [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }] }
}

export type VisitCtx = {
  user: SessionUser
  r: any
  patient: any
  team: boolean
  primary: boolean
}

/**
 * Load one visit for a field-app page: auth, access check (canView), people joined, patient.
 * Non-team viewers still see it (coordinators) but `team` is false so no actions render.
 */
export async function loadVisit(id: string, opts: { attachments?: boolean } = {}): Promise<VisitCtx & { attachments: any[] }> {
  const user = await requireAppUser()
  await db()
  if (!isOid(id)) notFound()
  const doc = await HomecareRequest.findOne({ _id: id, deletedAt: null }).lean<any>()
  if (!doc) notFound()
  if (!canView(user, doc)) redirect('/m/visits?denied=1')
  await withPeople([doc])
  doc.sla = slaInfo(doc, await getSettings())
  const patient = await Patient.findById(doc.patientId).lean<any>()
  const attachments = opts.attachments
    ? await Attachment.find({ requestId: doc._id, deletedAt: null }).select('kind filename mime size caption at uploadedBy').sort({ at: 1 }).lean<any[]>()
    : []
  return {
    user,
    r: plain(doc),
    patient: plain(patient ?? {}),
    attachments: plain(attachments),
    team: isTeamMember(user, doc),
    primary: String(doc.assignment?.primaryStaffId) === user.id,
  }
}

/** The coordinator on duty (for Help / Forgot / chat header). */
export async function coordinatorOnDuty() {
  await db()
  const u =
    (await User.findOne({ role: 'HC_ADMIN', status: 'ACTIVE', deletedAt: null, availability: 'ON_DUTY' }).select('name phone whatsapp').lean<any>()) ??
    (await User.findOne({ role: 'HC_ADMIN', status: 'ACTIVE', deletedAt: null }).select('name phone whatsapp').lean<any>())
  return u ? { name: u.name as string, phone: u.phone as string, whatsapp: (u.whatsapp || u.phone) as string } : null
}
