import { z } from 'zod'
import { publicRoute, body, notFound, conflict, clientMeta } from '@/lib/api'
import { HomecareRequest, isOid } from '@/lib/models'
import { audit } from '@/lib/audit'

const Input = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
})

/**
 * POST /api/v1/feedback/:requestId {rating 1–5, comment} — public (link in the thank-you message).
 * Only for completed / closed visits, and only once per visit.
 */
export const POST = publicRoute<{ id: string }>(async ({ req, params }) => {
  if (!isOid(params.id)) throw notFound('Visit')
  const input = await body(req, Input)
  const r = await HomecareRequest.findOne({ _id: params.id, deletedAt: null }).select('status requestNo feedback').lean<any>()
  if (!r) throw notFound('Visit')
  if (!['COMPLETED', 'CLOSED'].includes(r.status)) throw conflict('NOT_COMPLETED', 'Feedback opens once the visit is complete')
  if (r.feedback?.rating) throw conflict('ALREADY_SUBMITTED', 'Feedback for this visit was already received — thank you')
  const feedback = { rating: input.rating, comment: input.comment || undefined, at: new Date() }
  // atomic "only once": the filter fails if another submission landed first
  const res = await HomecareRequest.updateOne({ _id: r._id, 'feedback.rating': { $in: [null] } }, { $set: { feedback } })
  if (!res.modifiedCount) throw conflict('ALREADY_SUBMITTED', 'Feedback for this visit was already received — thank you')
  await audit(null, 'request.feedback', 'request', r._id, { after: { rating: input.rating, comment: input.comment }, label: r.requestNo }, { ...clientMeta(req, null), client: 'public' })
  return { ok: true }
})
