import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { hodAssign, HodAssignInput } from '@/lib/services/department-heads'

/** POST /api/v1/hod/assign/:requestId { primaryStaffId, secondaryStaffIds } — a head assigns their own staff. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return hodAssign(r, await body(req, HodAssignInput), user, clientMeta(req, user))
})
