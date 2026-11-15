import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { loadRequest } from '@/lib/services/requests'
import { staffLinkFor } from '@/lib/services/staff-links'

const Input = z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/i), fresh: z.boolean().optional() })

/** POST { userId, fresh? } — a team member's no-login bag & checklist link (copy / resend); fresh = new link, old one off. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'requests.manage') && !can(user, 'requests.assign')) throw forbidden()
  const r = await loadRequest(params.id, user)
  const { userId, fresh } = await body(req, Input)
  const team = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].map(String)
  if (!team.includes(userId)) throw bad('Only people on the care team get a staff link')
  if (['CANCELLED', 'CLOSED'].includes(r.status)) throw bad('This visit is over')
  const url = await staffLinkFor(r, userId, user.id, { fresh })
  await audit(user, fresh ? 'staff_link.renew' : 'staff_link.copy', 'request', r._id, { after: { userId }, label: r.requestNo }, clientMeta(req, user))
  return { url }
})
