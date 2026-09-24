import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { getSettings, saveSetting, DEFAULT_SETTINGS } from '@/lib/settings'
import { emailConfigured, queueEmail } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { blobEnabled } from '@/lib/storage'

export const GET = route(async () => {
  const s = await getSettings()
  return {
    settings: s,
    integrations: {
      gmail: { configured: emailConfigured(), user: process.env.GMAIL_USER ? process.env.GMAIL_USER.replace(/^(.{3}).*(@.*)$/, '$1•••$2') : null },
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

/** PATCH /api/v1/settings { key: 'sla', value: {...} } — non-secret config only */
export const PATCH = route(
  async ({ req, user }) => {
    const input = await body(req, Patch)
    const before = (await getSettings())[input.key]
    await saveSetting(input.key, { ...(before as object), ...input.value }, user.id)
    await audit(user, 'settings.update', 'settings', input.key, { before, after: input.value, label: input.key }, clientMeta(req, user))
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
)

/** POST /api/v1/settings { test: 'email', to } — send a test email */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, z.object({ test: z.literal('email'), to: z.string().email() }))
    const log = await queueEmail({ to: input.to, subject: 'Unico HomeCare · test email', text: `This is a test email sent by ${user.name} from Settings → Integrations.\n\nIf you can read this, Gmail is configured correctly.`, templateKey: 'test', initiatedBy: user.id })
    await audit(user, 'settings.test_email', 'settings', 'email', { after: { to: input.to } }, clientMeta(req, user))
    return { id: String(log._id), configured: emailConfigured() }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
)
