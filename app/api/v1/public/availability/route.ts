import { publicRoute } from '@/lib/api'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'
import { isoDay } from '@/lib/format'

/**
 * GET /api/v1/public/availability — live slot grid for the booking forms (no sign-in).
 * Optional ?from=YYYY-MM-DD&days=N (N 1–14, from today on) loads a later window, e.g. a date staff pick on the calendar.
 */
export const GET = publicRoute(async ({ req }) => {
  const s = await getSettings()
  if (!s.booking.enabled) return { enabled: false, days: [] }
  const sp = req.nextUrl.searchParams
  const from = sp.get('from')
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from) && from >= isoDay()) {
    const days = Math.min(Math.max(Number(sp.get('days')) || 1, 1), 14)
    return { enabled: true, days: await availability(s.booking, { from, days }) }
  }
  return { enabled: true, days: await availability(s.booking) }
})
