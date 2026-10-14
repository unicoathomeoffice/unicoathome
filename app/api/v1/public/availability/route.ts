import { publicRoute } from '@/lib/api'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'

/** GET /api/v1/public/availability — live slot grid for the public booking form (no sign-in). */
export const GET = publicRoute(async () => {
  const s = await getSettings()
  if (!s.booking.enabled) return { enabled: false, days: [] }
  return { enabled: true, days: await availability(s.booking) }
})
