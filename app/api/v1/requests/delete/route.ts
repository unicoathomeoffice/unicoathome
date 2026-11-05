import { route, body, clientMeta } from '@/lib/api'
import { deleteRequests, DeleteRequestsInput } from '@/lib/services/request-delete'

/** POST /api/v1/requests/delete {ids, reason} — remove unwanted / duplicate requests (soft delete, audited). */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, DeleteRequestsInput)
    return deleteRequests(input, user, clientMeta(req, user))
  },
  { perm: 'requests.delete' },
)
