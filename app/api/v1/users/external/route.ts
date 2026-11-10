import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { addExternalStaff } from '@/lib/services/external-staff'

export const maxDuration = 30

/** POST /api/v1/users/external {employeeId} — add a hospital employee from the HIS as outside staff (no login), or reuse their account. */
export const POST = route(
  async ({ req, user }) => {
    const { employeeId } = await body(req, z.object({ employeeId: z.string().min(2).max(20) }))
    return addExternalStaff(employeeId, user, clientMeta(req, user))
  },
  { perm: 'requests.assign' },
)
