import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { canOpenSettings } from '@/lib/constants'
import { getSettings, saveSetting } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { pumpWhatsApp, queueWhatsApp, unpairWhatsApp, waStatus } from '@/lib/wa/service'
import { bdMobile } from '@/lib/services/public'

export const maxDuration = 60 // a WhatsApp session may take ~10–30 s to open and send

/** GET — connection status + queue */
export const GET = route(async ({ user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const s = await getSettings()
  return { status: await waStatus(), autoSend: s.whatsapp.autoSend !== false }
})

/** PATCH { autoSend } */
export const PATCH = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const input = await body(req, z.object({ autoSend: z.boolean() }))
  const before = (await getSettings()).whatsapp
  await saveSetting('whatsapp', { ...before, autoSend: input.autoSend }, user.id)
  await audit(user, 'settings.update', 'settings', 'whatsapp', { before: { autoSend: before.autoSend }, after: input, label: 'whatsapp' }, clientMeta(req, user))
  return { ok: true }
})

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('test'), to: z.string().min(6), text: z.string().trim().min(1).max(1000).optional() }),
  z.object({ action: z.literal('pump') }),
  z.object({ action: z.literal('disconnect') }),
])

/** POST — test message · send queued now · disconnect */
export const POST = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const input = await body(req, Action)
  const meta = clientMeta(req, user)
  if (input.action === 'test') {
    const to = bdMobile(input.to)
    if (!to) throw bad('Enter a valid mobile number (01XXXXXXXXX)')
    await queueWhatsApp({ to, text: input.text ?? `Test message from Unico HomeCare (${user.name}). If you can read this, WhatsApp auto-send is working.`, templateKey: 'test', initiatedBy: user.id })
    const r = await pumpWhatsApp()
    await audit(user, 'settings.test_whatsapp', 'settings', 'whatsapp', { after: { to, ...r } }, meta)
    return { ok: true, ...r }
  }
  if (input.action === 'pump') return { ok: true, ...(await pumpWhatsApp(30)) }
  await unpairWhatsApp()
  await audit(user, 'settings.whatsapp_disconnect', 'settings', 'whatsapp', { label: 'WhatsApp disconnected' }, meta)
  return { ok: true }
})
