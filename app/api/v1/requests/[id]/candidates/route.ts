import { route, qp } from '@/lib/api'
import { loadRequest, rankCandidates } from '@/lib/services/requests'

/** GET /api/v1/requests/:id/candidates?role=DOCTOR,NURSE — ranked by skill 40 · availability 30 · zone 20 · workload 10 */
export const GET = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    const roles = qp(req).get('role')?.split(',')
    const limit = Math.min(80, Math.max(1, Number(qp(req).get('limit')) || 30))
    return { items: await rankCandidates(r, limit, roles) }
  },
  { perm: 'requests.assign' },
)
