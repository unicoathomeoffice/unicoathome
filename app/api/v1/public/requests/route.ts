import { publicRoute, body, clientMeta, ApiError } from '@/lib/api'
import { createPublicRequest, PublicRequestInput } from '@/lib/services/public'
import { getPatient } from '@/lib/patient-auth'

// naive in-memory limiter per instance: 5 requests per IP per hour (the 2-hour duplicate guard covers repeats)
const hits = new Map<string, number[]>()

/** POST /api/v1/public/requests — the public "Book a home visit" form. No sign-in. */
export const POST = publicRoute(async ({ req }) => {
  const meta = { ...clientMeta(req), client: 'website' }
  const now = Date.now()
  const recent = (hits.get(meta.ip) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= 5) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests from this connection. Please call the Home Care hotline.')
  const input = await body(req, PublicRequestInput)
  if (input.website) return { ok: true, requestNo: 'HC-RECEIVED', callWithinMin: 15 } // honeypot: pretend success to bots
  hits.set(meta.ip, [...recent, now])
  const patient = await getPatient()
  return { ok: true, ...(await createPublicRequest(input, { ...meta, client: patient ? 'portal' : 'website' }, patient?.id)) }
})
