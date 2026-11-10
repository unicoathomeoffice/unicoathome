import { z } from 'zod'
import { route, body, clientMeta, forbidden, bad } from '@/lib/api'
import { ALERT_EVENTS, can, canOpenSettings } from '@/lib/constants'
import { getSettings, saveSetting, DEFAULT_SETTINGS, HOD_CATEGORIES } from '@/lib/settings'
import { emailConfigured, queueEmail } from '@/lib/messaging'
import { getGmailStatus } from '@/lib/gmail'
import { audit } from '@/lib/audit'
import { blobEnabled } from '@/lib/storage'
import { isPaired } from '@/lib/wa/status'

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

const HodPatch = z
  .object({
    enabled: z.boolean(),
    groups: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          name: z.string().trim().min(2, 'Give every group a name').max(60),
          category: z.string().max(40).optional(),
          services: z.union([z.literal('ALL'), z.array(z.string().max(40)).max(100)]),
          message: z.string().max(1000).optional(),
          active: z.boolean(),
          events: z.array(z.enum(ALERT_EVENTS)).max(ALERT_EVENTS.length).optional(),
          system: z.enum(['security', 'transport', 'live']).optional(),
        }),
      )
      .max(30),
    contacts: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          groupId: z.string().min(1).max(40),
          category: z.enum(HOD_CATEGORIES).optional(),
          name: z.string().trim().min(2, 'Name is required').max(80),
          designation: z.string().trim().min(2, 'Designation is required').max(80),
          phone: z.string().trim().refine((v) => v.replace(/[^0-9]/g, '').length >= 10, 'Enter a full mobile number'),
          services: z.array(z.string().max(40)).max(100).optional(),
          active: z.boolean(),
        }),
      )
      .max(200),
  })
  .partial()
  .strict()
  .refine((v) => !v.contacts || !v.groups || v.contacts.every((c) => v.groups!.some((g) => g.id === c.groupId)), 'Every person must belong to a group')

/** PATCH /api/v1/settings { key: 'sla', value: {...} } — non-secret config only. Online booking: requests.manage. */
export const PATCH = route(
  async ({ req, user }) => {
    const input = await body(req, Patch)
    if (!(input.key === 'booking' ? can(user, 'requests.manage') : canOpenSettings(user))) throw forbidden()
    if (input.key === 'maps') {
      const r = z.object({ useGoogle: z.boolean(), monthlyFree: z.number().int().min(100).max(1_000_000), reservePct: z.number().int().min(0).max(50), dailyCap: z.union([z.literal('none'), z.literal('auto'), z.number().int().min(1).max(100_000)]) }).partial().strict().safeParse(input.value)
      if (!r.success) throw bad(`Maps: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
    if (input.key === 'hodAlerts') {
      const r = HodPatch.safeParse(input.value)
      if (!r.success) throw bad(`Department heads: ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
    if (input.key === 'visitUpdates') {
      const r = z
        .object({
          enabled: z.boolean(),
          toHods: z.boolean(),
          toPatient: z.boolean(),
          extra: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(2).max(80), phone: z.string().trim().refine((v) => v.replace(/[^0-9]/g, '').length >= 10, 'Enter a full mobile number') })).max(30),
        })
        .partial()
        .strict()
        .safeParse(input.value)
      if (!r.success) throw bad(`Visit updates: ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
    if (input.key === 'transportDocs') {
      const HM2 = z.union([HM, z.literal('')])
      const r = z
        .object({
          sendRequisition: z.boolean(),
          sendGatePass: z.boolean(),
          vehicleType: z.enum(['Car', 'Micro', 'Ambulance']),
          approverId: z.string().max(40),
          emailCopy: z.union([z.string().email(), z.literal('')]),
          supervisors: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(2).max(80), phone: z.string().trim().refine((v) => v.replace(/[^0-9]/g, '').length >= 10, 'Enter a full mobile number'), from: HM2, to: HM2, active: z.boolean() })).max(20),
          pettyCash: z.object({
            name: z.string().trim().max(80),
            phone: z.string().trim().refine((v) => !v || v.replace(/[^0-9]/g, '').length >= 10, 'Enter a full mobile number'),
            defaultAmount: z.number().int().min(0).max(50000),
          }),
        })
        .partial()
        .strict()
        .safeParse(input.value)
      if (!r.success) throw bad(`Car requisition: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
    if (input.key === 'whatsappSafety') {
      const n = (min: number, max: number) => z.number().int().min(min).max(max)
      const r = z
        .object({
          perMinute: n(1, 20),
          perHour: n(5, 300),
          perDay: n(20, 1500),
          perRecipientHour: n(1, 20),
          perRecipientDay: n(1, 60),
          delayMinSec: n(1, 30),
          delayMaxSec: n(1, 60),
          typing: z.boolean(),
          checkNumbers: z.boolean(),
          dedupeMin: n(0, 240),
          quietHours: z.boolean(),
          warmUpDays: n(0, 30),
          optOut: z.boolean(),
        })
        .partial()
        .strict()
        .safeParse(input.value)
      if (!r.success) throw bad(`WhatsApp safety: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
    if (input.key === 'dailyWhatsApp') {
      const r = z
        .object({
          enabled: z.boolean(),
          time: HM,
          toHods: z.boolean(),
          toUpdateNumbers: z.boolean(),
          extra: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(2).max(80), phone: z.string().trim().refine((v) => v.replace(/[^0-9]/g, '').length >= 10, 'Enter a full mobile number') })).max(30),
        })
        .partial()
        .strict()
        .safeParse(input.value)
      if (!r.success) throw bad(`Daily summary: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
      input.value = r.data
    }
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
    const input = await body(req, z.discriminatedUnion('test', [z.object({ test: z.literal('email'), to: z.string().email() }), z.object({ test: z.literal('hod'), to: z.string().min(6), name: z.string().max(80).optional() })]))
    if (input.test === 'hod') {
      if (!(await isPaired())) throw bad('WhatsApp is not paired — pair it in Settings → WhatsApp first')
      const { queueWhatsApp } = await import('@/lib/wa/service')
      const log = await queueWhatsApp({ to: input.to, toName: input.name, text: `Unico HomeCare · test message for ${input.name || 'the department head'}.\nYou will get a WhatsApp like this whenever a new home care request for your service needs assignment.\n— sent by ${user.name}`, templateKey: 'test', initiatedBy: user.id, approved: true })
      await audit(user, 'settings.test_whatsapp', 'settings', 'hodAlerts', { after: { to: log.to } }, clientMeta(req, user))
      return { id: String(log._id), to: log.to }
    }
    const log = await queueEmail({ to: input.to, subject: 'Unico HomeCare · test email', text: `This is a test email sent by ${user.name} from Settings → Integrations.\n\nIf you can read this, Gmail is configured correctly.`, templateKey: 'test', initiatedBy: user.id })
    await audit(user, 'settings.test_email', 'settings', 'email', { after: { to: input.to } }, clientMeta(req, user))
    return { id: String(log._id), configured: (await emailConfigured()) }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
)
