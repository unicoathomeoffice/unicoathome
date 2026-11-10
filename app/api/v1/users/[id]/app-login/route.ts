import { route, clientMeta, forbidden, notFound, bad } from '@/lib/api'
import { can } from '@/lib/constants'
import { User } from '@/lib/models'
import { grantAppLogin } from '@/lib/services/external-staff'

export const maxDuration = 30

/** POST /api/v1/users/:id/app-login — give (or resend) a HomeCare phone-app login: new temporary PIN on WhatsApp. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'users.manage') && !can(user, 'requests.assign')) throw forbidden()
  const u = await User.findOne({ _id: params.id, deletedAt: null }).select('name role external status platformAccess phone whatsapp employeeId')
  if (!u) throw notFound('Staff member')
  if (u.status !== 'ACTIVE') throw bad(`${u.name} is not active`)
  if (!u.employeeId) throw bad(`${u.name} has no employee ID to sign in with`)
  return grantAppLogin(u, user, clientMeta(req, user))
})
