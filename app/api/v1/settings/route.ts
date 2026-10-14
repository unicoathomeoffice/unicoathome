import { z } from 'zod'
import { route, body, clientMeta, forbidden, bad } from '@/lib/api'
import { can, canOpenSettings } from '@/lib/constants'
import { getSettings, saveSetting, DEFAULT_SETTINGS } from '@/lib/settings'
import { emailConfigured, queueEmail } from '@/lib/messaging'
import { getGmailStatus } from '@/lib/gmail'
import { audit } from '@/lib/audit'
import { blobEnabled } from '@/lib/storage'

export const GET = route(async () => {
  const s = await getSettings()
  const gmail = await getGmailStatus()
  return {
    settings: s,
    integrations: {
      gmail: { configured: gmail.configured, mode: gmail.mode },
      whatsapp: { mode: 'deeplink', country: process.env.WA_DEFAULT_COUNTRY ?? '880' },
      cron: { configured: !!process.env.CRON_SECRET },
      database: { name: 'MongoDB Atlas' },
      storage: { provider: blobEnabled() ? 'Vercel Blob (private)' : 'MongoDB (inline)', blob: blobEnabled() },
    },
  }
})

const Patch = z.object({
  key: z.enum(Object.keys(DEFAULT_SETTINGS) as [keyof typeof DEFAULT_SETTINGS]),
  value: z.record(z.string(), z.any()),
})

const HM = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const BookingPatch = z
  .object({
    enabled: z.boolean(),
    from: HM,
    to: HM,
    slotMin: z.number().int().min(15).max(480),
    bufferMin: z.number().int().min(0).max(240),
    capacity: z.number().int().min(1).max(50),
    leadMin: z.number().int().min(0).max(10080),
    daysAhead: z.number().int().min(1).max(60),
    closedWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
    closedDates: z.array(Day).max(400),
    blocked: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).max(2000),
    holdNew: z.boolean(),
  })
  .partial()
  .strict()

/** PATCH /api/v1/settings { key: 'sla', value: {...} } — non-secret config only. Online booking: requests.manage. */
export const PATCH = route(
  async ({ req, user }) => {
    const input = await body(req, Patch)
    if (!(input.key === 'booking' ? can(user, 'requests.manage') : canOpenSettings(user))) throw forbidden()
    if (input.key === 'booking') {
      const r = BookingPatch.safeParse(input.value)
      if (!r.success) throw bad(`Booking: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
    const before = (await getSettings())[input.key]
    await saveSetting(input.key, { ...(before as object), ...input.value }, user.id)
    await audit(user, 'settings.update', 'settings', input.key, { before, after: input.value, label: input.key }, clientMeta(req, user))
    return { ok: true }
  },
)

/** POST /api/v1/settings { test: 'email', to } — send a test email */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, z.object({ test: z.literal('email'), to: z.string().email() }))
    const log = await queueEmail({ to: input.to, subject: 'Unico HomeCare · test email', text: `This is a test email sent by ${user.name} from Settings → Integrations.\n\nIf you can read this, Gmail is configured correctly.`, templateKey: 'test', initiatedBy: user.id })
    await audit(user, 'settings.test_email', 'settings', 'email', { after: { to: input.to } }, clientMeta(req, user))
    return { id: String(log._id), configured: (await emailConfigured()) }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
)
