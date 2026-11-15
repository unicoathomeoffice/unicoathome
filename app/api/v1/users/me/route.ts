import { z } from 'zod'
import { route, body, clientMeta, bad } from '@/lib/api'
import { User, Session, Device } from '@/lib/models'
import { forgetAuth, hashPassword, verifyPassword } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'

export const GET = route(async ({ user }) => {
  const u = await User.findById(user.id).lean<any>()
  const sessions = await Session.find({ userId: user.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean<any[]>()
  return { user: plain(u), sessions: plain(sessions.map((s) => ({ ...s, current: s.jti === user.jti }))) }
})

const Patch = z.object({
  availability: z.enum(['ON_DUTY', 'OFF_DUTY', 'ON_LEAVE']).optional(),
  notificationPrefs: z.object({ push: z.boolean().optional(), email: z.boolean().optional(), whatsapp: z.boolean().optional(), quietHours: z.object({ from: z.string(), to: z.string() }).optional() }).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
  signOutSessionId: z.string().optional(),
  signOutOthers: z.boolean().optional(),
})

/** Self-service: availability toggle, notification prefs, password, device sessions. */
export const PATCH = route(async ({ req, user }) => {
  const input = await body(req, Patch)
  const u = await User.findById(user.id).select('+passwordHash')
  if (!u) throw bad('User not found')
  const meta = clientMeta(req, user)
  if (input.availability && input.availability !== u.availability) {
    await audit(user, 'user.availability', 'user', u._id, { before: { availability: u.availability }, after: { availability: input.availability }, label: u.name }, meta)
    u.availability = input.availability
  }
  if (input.notificationPrefs) {
    const prefs = { ...(u.toObject() as any).notificationPrefs, ...input.notificationPrefs }
    prefs.push = true // assignment push cannot be disabled (plan §5.7)
    u.set('notificationPrefs', prefs)
  }
  if (input.newPassword) {
    if (!input.currentPassword || !(await verifyPassword(input.currentPassword, u.passwordHash!))) throw bad('Current password is incorrect', { currentPassword: 'Incorrect' })
    u.passwordHash = await hashPassword(input.newPassword)
    u.mustChangePassword = false
    await audit(user, 'user.password_change', 'user', u._id, { label: u.name }, meta)
  }
  await u.save()
  if (input.signOutSessionId) {
    const s = await Session.findOneAndUpdate({ _id: input.signOutSessionId, userId: user.id }, { revokedAt: new Date() }).lean<any>()
    // that phone stops receiving push messages too
    if (s?.jti) await Device.updateMany({ jti: s.jti }, { $unset: { pushToken: 1, jti: 1 }, waHost: false })
  }
  if (input.signOutOthers) {
    await Session.updateMany({ userId: user.id, jti: { $ne: user.jti }, revokedAt: null }, { revokedAt: new Date() })
    await Device.updateMany({ userId: user.id, jti: { $ne: user.jti } }, { $unset: { pushToken: 1, jti: 1 }, waHost: false })
  }
  forgetAuth() // availability, sign-outs
  return { ok: true }
})
