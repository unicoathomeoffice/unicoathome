import { route, qp } from '@/lib/api'
import { plain } from '@/lib/db'
import { listApprovals } from '@/lib/services/approvals'

/** GET /api/v1/approvals?status=PENDING|APPROVED|REJECTED|ALL&type=&requestedBy= */
export const GET = route(
  async ({ req }) => {
    const p = qp(req)
    const items = await listApprovals({ status: p.get('status') ?? 'PENDING', type: p.get('type') ?? undefined, requestedBy: p.get('requestedBy') ?? undefined })
    return { items: plain(items) }
  },
  { perm: 'approvals.decide' },
)
