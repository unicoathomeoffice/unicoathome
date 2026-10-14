import { z } from 'zod'
import { publicRoute, body, clientMeta } from '@/lib/api'
import { KINDS, PROVIDERS, recordUsage } from '@/lib/maps-usage'

const Input = z.object({ provider: z.enum(PROVIDERS), kind: z.enum(KINDS), n: z.number().int().min(1).max(20).default(1) })

// light per-IP guard so a script can't inflate the counters: 600 reports / hour
const hits = new Map<string, number[]>()

/** POST /api/v1/public/maps-usage — browsers report each map / geocoding call they made (sendBeacon). */
export const POST = publicRoute(async ({ req }) => {
  const { ip } = clientMeta(req)
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= 600) return { ok: true }
  hits.set(ip, [...recent, now])
  const input = await body(req, Input)
  await recordUsage(input.provider, input.kind, input.n)
  return { ok: true }
})
