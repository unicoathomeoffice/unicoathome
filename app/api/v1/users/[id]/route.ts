import { z } from 'zod'
import { route, body, clientMeta, notFound, bad } from '@/lib/api'
import { User, Session, Vehicle, HomecareRequest, isOid } from '@/lib/models'
import { hashPassword } from '@/lib/auth'
import { audit, diff } from '@/lib/audit'
import { plain } from '@/lib/db'
import { UserInput } from '@/lib/schemas'

export const GET = route<{ id: string }>(
  async ({ params }) => {
    if (!isOid(params.id)) throw notFound('User')
    const u = await User.findById(params.id).lean<any>()
    if (!u) throw notFound('User')
    const [sessions, recent] = await Promise.all([
      Session.find({ userId: params.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean(),
      HomecareRequest.find({ $or: [{ 'assignment.primaryStaffId': params.id }, { 'assignment.secondaryStaffIds': params.id }] }).select('requestNo status scheduledAt patientSnapshot.name services').sort({ scheduledAt: -1 }).limit(20).lean(),
    ])
    return { user: plain(u), sessions: plain(sessions), recent: plain(recent) }
  },
  { perm: 'users.read' },
)

const Patch = UserInput.partial().extend({
  forceSignOut: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
})

export const PATCH = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw notFound('User')
    const u = await User.findById(params.id)
    if (!u) throw notFound('User')
    const sent = (await req.clone().json().catch(() => ({}))) ?? {}
    const { forceSignOut, resetPassword, password, ...parsed } = await body(req, Patch)
    // zod 4 applies .default() inside .partial() — keep only keys the client actually sent
    const input = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent)) as typeof parsed
    const pick = (o: any) => ({ name: o.name, phone: o.phone, email: o.email, role: o.role, status: o.status, platformAccess: o.platformAccess, designationId: String(o.designationId ?? ''), customRoleId: String(o.customRoleId ?? ''), skills: o.skills, zones: o.zones, shift: o.shift, availability: o.availability })
    const before = pick(u.toObject())
    if (input.phone && input.phone !== u.phone && (await User.exists({ phone: input.phone, _id: { $ne: u._id } }))) throw bad('Phone already belongs to another user')
    for (const k of ['departmentId', 'designationId', 'vehicleId', 'supervisorId', 'email', 'customRoleId'] as const) if (k in input && !input[k]) (input as any)[k] = undefined
    u.set({ ...input, licenceExpiry: input.licenceExpiry ? new Date(input.licenceExpiry) : u.licenceExpiry })
    let temporaryPassword: string | undefined
    if (password) u.passwordHash = await hashPassword(password)
    if (resetPassword) {
      temporaryPassword = Math.random().toString(36).slice(2, 10) + 'A1'
      u.passwordHash = await hashPassword(temporaryPassword)
      u.mustChangePassword = true
    }
    await u.save()
    if (input.role === 'DRIVER' && input.vehicleId) await Vehicle.updateOne({ _id: input.vehicleId }, { driverId: u._id })
    if (forceSignOut || input.status === 'SUSPENDED' || resetPassword) await Session.updateMany({ userId: u._id, revokedAt: null }, { revokedAt: new Date() })
    await audit(user, input.status && input.status !== before.status ? `user.${input.status.toLowerCase()}` : 'user.update', 'user', u._id, { ...diff(before, pick(u.toObject())), label: u.name }, clientMeta(req, user))
    if (forceSignOut) await audit(user, 'user.force_sign_out', 'user', u._id, { label: u.name }, clientMeta(req, user))
    return { ok: true, temporaryPassword }
  },
  { perm: 'users.manage' },
)
