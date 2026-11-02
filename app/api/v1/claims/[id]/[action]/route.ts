import { z } from 'zod'
import { route, body, clientMeta, notFound } from '@/lib/api'
import { isOid } from '@/lib/models'
import { decideClaim, markPaid, resendClaim } from '@/lib/services/claims'

export const maxDuration = 60

/** POST /api/v1/claims/:id/(decide|paid|resend) */
export const POST = route<{ id: string; action: string }>(async ({ req, user, params }) => {
  if (!isOid(params.id)) throw notFound('Claim')
  const meta = clientMeta(req, user)
  if (params.action === 'decide') {
    await decideClaim(params.id, await body(req, z.object({ approve: z.boolean(), note: z.string().max(300).optional() })), user, meta)
    return { ok: true }
  }
  if (params.action === 'paid') {
    await markPaid(params.id, user, meta)
    return { ok: true }
  }
  if (params.action === 'resend') return resendClaim(params.id, user, meta)
  throw notFound('Action')
})
