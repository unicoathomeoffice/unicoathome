import { route, clientMeta, forbidden } from '@/lib/api'
import { canOpenSettings } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { buildDailySummary, sendDailySummary } from '@/lib/services/daily'

export const maxDuration = 60

/** GET /api/v1/daily-summary — today's WhatsApp summary text (preview). */
export const GET = route(async ({ user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  return { text: await buildDailySummary() }
})

/** POST /api/v1/daily-summary — send it now to the chosen people. */
export const POST = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const out = await sendDailySummary({ force: true, initiatedBy: user.id })
  await audit(user, 'message.daily_summary', 'settings', 'dailyWhatsApp', { after: out }, clientMeta(req, user))
  return out
})
