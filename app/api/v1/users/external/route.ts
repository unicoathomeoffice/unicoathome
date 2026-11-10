import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { addExternalStaff } from '@/lib/services/external-staff'

export const maxDuration = 30

/** POST /api/v1/users/external {employeeId, appAccess?} — add a hospital employee from the HIS (or reuse their account);
 *  appAccess: also give them a HomeCare app login (temporary PIN on WhatsApp). */
export const POST = route(
  async ({ req, user }) => {
    const { employeeId, appAccess } = await body(req, z.object({ employeeId: z.string().min(2).max(20), appAccess: z.boolean().optional() }))
    return addExternalStaff(employeeId, user, clientMeta(req, user), { appAccess })
  },
  { perm: 'requests.assign' },
)
