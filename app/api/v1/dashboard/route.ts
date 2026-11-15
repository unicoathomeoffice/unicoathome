import { after } from 'next/server'
import { route } from '@/lib/api'
import { dashboardData } from '@/lib/services/dashboard'
import { googleBudget } from '@/lib/maps-usage'
import { getSettings } from '@/lib/settings'
import { sweep } from '@/lib/services/jobs'
import { plain } from '@/lib/db'

/**
 * GET — the operations dashboard (web /dashboard): KPI tiles, 14-day trend, timing metrics, live visits,
 * escalations, service and zone mix, maps budget. Runs the overdue / accept-timeout sweep in the background.
 * Field staff use GET /app/home instead.
 */
export const GET = route(
  async () => {
    after(async () => {
      try {
        await sweep()
      } catch (e) {
        console.error('sweep failed', e)
      }
    })
    const [data, maps] = await Promise.all([dashboardData(), getSettings().then((s) => googleBudget(s.maps))])
    return plain({ ...data, maps })
  },
  { perm: 'requests.readAll' },
)
