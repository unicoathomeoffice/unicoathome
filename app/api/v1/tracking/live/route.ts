import { route } from '@/lib/api'
import { liveBoard } from '@/lib/services/tracking'
import { background } from '@/lib/messaging'
import { sweep } from '@/lib/services/jobs'

/** GET /api/v1/tracking/live — every team currently travelling (to a patient or back to the hospital). */
export const GET = route(
  async () => {
    background(() => sweep()) // drives the 'location lost' alerts while someone watches (throttled to 1/min)
    return { items: await liveBoard() }
  },
  { perm: 'requests.readAll' },
)
