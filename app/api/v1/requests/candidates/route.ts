import { z } from 'zod'
import { route, body } from '@/lib/api'
import { ServiceType } from '@/lib/models'
import { rankCandidates, slotStart } from '@/lib/services/requests'
import { dhakaDate } from '@/lib/format'

const Input = z.object({
  serviceCodes: z.array(z.string()).default([]),
  date: z.string().optional(), // YYYY-MM-DD
  time: z.string().optional(),
  slot: z.string().optional(),
  durationMin: z.coerce.number().int().positive().optional(),
  area: z.string().optional(),
  roles: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(80).default(60),
})

/** POST /api/v1/requests/candidates — rank staff for a request that isn't saved yet (New request → Assign staff). */
export const POST = route(
  async ({ req }) => {
    const i = await body(req, Input)
    const types = await ServiceType.find({ code: { $in: i.serviceCodes } }).select('defaultDurationMin').lean<any[]>()
    const draft = {
      services: types.map((t) => ({ serviceTypeId: t._id })),
      scheduledAt: i.date ? dhakaDate(i.date, i.time || slotStart(i.slot)) : undefined,
      expectedDurationMin: i.durationMin ?? Math.max(...types.map((t) => t.defaultDurationMin ?? 45), 30),
      patientSnapshot: { area: i.area || undefined },
    }
    return { items: await rankCandidates(draft, i.limit, i.roles) }
  },
  { perm: 'requests.assign' },
)
