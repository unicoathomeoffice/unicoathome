import { route, body } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { liveView, PingInput, recordPing } from '@/lib/services/tracking'
import { background } from '@/lib/messaging'
import { sweep } from '@/lib/services/jobs'

/** POST /api/v1/requests/:id/location — a live point from the care team's phone (every ~15 s while travelling). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return recordPing(r, await body(req, PingInput), user)
})

/** GET /api/v1/requests/:id/location — last point, trail, destination and ETA (anyone who can open the request). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  background(() => sweep()) // a coordinator watching the map also drives the 'location lost' check (throttled to 1/min)
  return liveView(r)
})
