import { z } from 'zod'
import { cookies } from 'next/headers'
import { publicRoute, body, bad, clientMeta, ApiError } from '@/lib/api'
import { Approval, Department, User, isOid } from '@/lib/models'
import { defaultPlatformAccess, SIGNUP_ROLES } from '@/lib/constants'
import { readSignup, SIGNUP_COOKIE } from '@/lib/google-auth'
import { bdMobile } from '@/lib/services/public'
import { background, notifyRoles } from '@/lib/messaging'
import { audit } from '@/lib/audit'

const Input = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(80),
  phone: z.string().trim().refine((v) => !!bdMobile(v), 'Enter a valid mobile number (01XXXXXXXXX)'),
  employeeId: z.string().trim().min(2, 'Enter your employee ID').max(30).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
  role: z.enum(SIGNUP_ROLES, { message: 'Choose your role' }),
  departmentId: z.string().optional().or(z.literal('')),
  note: z.string().trim().max(300).optional(),
})

/** POST /api/v1/auth/register — finish Google sign-up: creates a PENDING account for an admin to approve. */
export const POST = publicRoute(async ({ req }) => {
  const jar = await cookies()
  const g = await readSignup(jar.get(SIGNUP_COOKIE)?.value)
  if (!g) throw new ApiError(400, 'SIGNUP_EXPIRED', 'Your Google sign-in expired. Start again from the Join page.')
  const input = await body(req, Input)
  const phone = bdMobile(input.phone)!
  const variants = [phone, phone.slice(1), `+880${phone.slice(1)}`, `880${phone.slice(1)}`, `+880 ${phone.slice(1, 5)}-${phone.slice(5)}`]

  const taken = await User.findOne({ $or: [{ email: g.email }, { employeeId: new RegExp(`^${input.employeeId}$`, 'i') }, { phone: { $in: variants } }] }).select('email employeeId phone status').lean<any>()
  if (taken?.email === g.email) throw bad(taken.status === 'PENDING' ? 'You have already registered — your account is waiting for approval.' : 'This Google account already has a staff account. Sign in instead.')
  if (taken && String(taken.employeeId).toLowerCase() === input.employeeId.toLowerCase()) throw bad('This employee ID is already registered. Check it, or ask the administrator.', { employeeId: 'Already registered' })
  if (taken) throw bad('This mobile number already belongs to a staff account.', { phone: 'Already registered' })
  const departmentId = input.departmentId && isOid(input.departmentId) && (await Department.exists({ _id: input.departmentId })) ? input.departmentId : undefined

  const u = await User.create({
    employeeId: input.employeeId,
    name: input.name,
    phone,
    whatsapp: phone,
    email: g.email,
    role: input.role,
    departmentId,
    platformAccess: defaultPlatformAccess(input.role),
    status: 'PENDING',
    availability: 'OFF_DUTY',
    photoUrl: g.picture,
  })
  jar.delete(SIGNUP_COOKIE)
  await Approval.create({ type: 'NEW_USER', userId: u._id, payload: { name: u.name, role: u.role, email: g.email, note: input.note, selfSignup: true } })
  await audit(null, 'user.register', 'user', u._id, { after: { name: u.name, email: g.email, role: input.role, employeeId: input.employeeId, note: input.note }, label: u.name }, clientMeta(req))
  background(() =>
    notifyRoles(['SUPER_ADMIN'], { type: 'APPROVAL', title: `New staff sign-up: ${u.name}`, body: `${input.role.replace('_', ' ').toLowerCase()} · ${input.employeeId} · ${g.email}${input.note ? ` · “${input.note}”` : ''}`, url: '/settings/approvals?type=NEW_USER', priority: 'high' }),
  )
  return { ok: true }
})
