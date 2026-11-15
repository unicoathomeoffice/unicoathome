import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { Device } from '@/lib/models'
import { audit } from '@/lib/audit'

const Input = z.object({
  installId: z.string().min(8).max(80),
  platform: z.enum(['android']).default('android'),
  model: z.string().max(120).optional(),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
  appBuild: z.number().int().nonnegative().optional(),
  pushToken: z.string().max(4096).nullable().optional(),
})

/** GET — the signed-in person's phones (profile → Devices). */
export const GET = route(async ({ user }) => {
  const items = await Device.find({ userId: user.id, revokedAt: null }).sort({ lastSeenAt: -1 }).lean<any[]>()
  return { items: items.map((d) => ({ ...d, current: d.jti === user.jti })) }
})

/**
 * POST — register or refresh this phone. Called after sign-in, on every app start and whenever Firebase hands out a
 * new push token. One row per install; a push token is only ever kept on one row, so a phone passed to another
 * staff member never receives the previous owner's alerts.
 */
export const POST = route(async ({ req, user }) => {
  const input = await body(req, Input)
  if (input.pushToken) await Device.updateMany({ pushToken: input.pushToken, installId: { $ne: input.installId } }, { $unset: { pushToken: 1 } })
  const before = await Device.findOne({ installId: input.installId }).lean<any>()
  const set: Record<string, unknown> = {
    userId: user.id,
    jti: user.jti,
    platform: input.platform,
    model: input.model,
    osVersion: input.osVersion,
    appVersion: input.appVersion,
    appBuild: input.appBuild,
    lastSeenAt: new Date(),
    revokedAt: null,
  }
  if (input.pushToken !== undefined) Object.assign(set, { pushToken: input.pushToken, pushUpdatedAt: new Date() })
  // a different person signing in on this phone: it is no longer the WhatsApp host
  if (before && String(before.userId) !== user.id) set.waHost = false
  const d = await Device.findOneAndUpdate({ installId: input.installId }, { $set: set }, { upsert: true, new: true }).lean<any>()
  if (!before || String(before.userId) !== user.id) await audit(user, 'device.register', 'device', d._id, { label: `${input.model ?? 'Android'} · ${input.appVersion ?? ''}` }, clientMeta(req, user))
  return { ok: true, id: String(d._id) }
})
