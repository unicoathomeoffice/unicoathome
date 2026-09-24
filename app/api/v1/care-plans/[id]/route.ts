import { route, body, clientMeta } from '@/lib/api'
import { plain } from '@/lib/db'
import { planDetail, updatePlan, addPlanVisit, CarePlanPatch, AddVisitInput } from '@/lib/services/careplans'

/** GET /api/v1/care-plans/:id — plan with its occurrences */
export const GET = route<{ id: string }>(async ({ user, params }) => plain(await planDetail(params.id, user)))

/** PATCH /api/v1/care-plans/:id {status?: ACTIVE|PAUSED|ENDED, title?, orderedBy?} — pausing cancels future NEW/CONFIRMED occurrences */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  const input = await body(req, CarePlanPatch)
  return { ok: true, ...(await updatePlan(params.id, input, user, clientMeta(req, user))) }
})

/** POST /api/v1/care-plans/:id {date, time?} — add one visit to the plan */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const input = await body(req, AddVisitInput)
    const r = await addPlanVisit(params.id, input, user, clientMeta(req, user))
    return { id: String(r._id), requestNo: r.requestNo }
  },
  { perm: 'requests.create' },
)
