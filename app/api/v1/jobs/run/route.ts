import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { sweep, reminders, dailyDigest } from '@/lib/services/jobs'
import { audit } from '@/lib/audit'

const Input = z.object({ job: z.enum(['sweep', 'reminders', 'digest']).default('sweep') })

/**
 * POST /api/v1/jobs/run {job} — run a scheduled job now from Settings (admins; no CRON_SECRET needed).
 * Takes precedence over /jobs/[job] because the static segment wins.
 */
export const POST = route(
  async ({ req, user }) => {
    const { job } = await body(req, Input)
    const result = job === 'sweep' ? await sweep(true) : job === 'reminders' ? await reminders() : await dailyDigest()
    await audit(user, 'jobs.run', 'job', job, { after: result as Record<string, unknown>, label: job }, clientMeta(req, user))
    return { ok: true, job, result }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
)
