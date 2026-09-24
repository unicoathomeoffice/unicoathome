import { route, body, clientMeta, qp } from '@/lib/api'
import { plain } from '@/lib/db'
import { createCarePlan, listPlans, CarePlanInput } from '@/lib/services/careplans'

/** GET /api/v1/care-plans?patientId=&status=ACTIVE,PAUSED */
export const GET = route(async ({ req, user }) => {
  const p = qp(req)
  return { items: plain(await listPlans(user, { patientId: p.get('patientId') ?? undefined, status: p.get('status') ?? undefined })) }
})

/** POST /api/v1/care-plans {patientId, serviceCode, daysOfWeek[], time, slot?, startDate, weeks, orderedBy?, title?} — generates one NEW request per occurrence */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, CarePlanInput)
    const { plan, count } = await createCarePlan(input, user, clientMeta(req, user))
    return { id: String(plan._id), count }
  },
  { perm: 'requests.create' },
)
