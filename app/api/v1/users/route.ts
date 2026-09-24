import { z } from 'zod'
import { route, body, clientMeta, qp, bad } from '@/lib/api'
import { User, Designation, Department, Vehicle, Approval } from '@/lib/models'
import { defaultPlatformAccess, can } from '@/lib/constants'
import { hashPassword } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'
import { UserInput } from '@/lib/schemas'

/** GET /api/v1/users?role=NURSE,DOCTOR&availability=ON_DUTY&q=&status= */
export const GET = route(
  async ({ req }) => {
    const p = qp(req)
    const f: Record<string, any> = { deletedAt: null }
    if (p.get('role')) f.role = { $in: p.get('role')!.split(',') }
    if (p.get('availability')) f.availability = p.get('availability')
    if (p.get('status')) f.status = p.get('status')
    if (p.get('dept')) f.departmentId = p.get('dept')
    if (p.get('q')) {
      const q = p.get('q')!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      f.$or = [{ name: new RegExp(q, 'i') }, { employeeId: new RegExp(q, 'i') }, { phone: new RegExp(q) }, { email: new RegExp(q, 'i') }]
    }
    const users = await User.find(f).sort({ role: 1, name: 1 }).lean<any[]>()
    const [desigs, depts, vehicles] = await Promise.all([Designation.find().lean<any[]>(), Department.find().lean<any[]>(), Vehicle.find().select('name plate').lean<any[]>()])
    for (const u of users) {
      u.designation = desigs.find((d) => String(d._id) === String(u.designationId))?.title
      u.department = depts.find((d) => String(d._id) === String(u.departmentId))?.name
      u.vehicle = vehicles.find((v) => String(v._id) === String(u.vehicleId)) ?? null
    }
    return { items: plain(users) }
  },
  { perm: 'users.read' },
)


const clean = (v?: string) => (v ? v : undefined)

export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, UserInput)
    const dupe = await User.findOne({ $or: [{ employeeId: input.employeeId }, { phone: input.phone }, ...(input.email ? [{ email: input.email.toLowerCase() }] : [])] }).select('employeeId phone email').lean<any>()
    if (dupe) throw bad(dupe.employeeId === input.employeeId ? 'Employee ID already exists' : dupe.phone === input.phone ? 'Phone already belongs to another user' : 'Email already belongs to another user')
    const password = input.password ?? Math.random().toString(36).slice(2, 10) + 'A1'
    // Only SUPER_ADMIN creates active users directly; coordinators' submissions wait in Approvals.
    const direct = can(user, 'users.manage')
    const u = await User.create({
      ...input,
      email: clean(input.email),
      departmentId: clean(input.departmentId),
      designationId: clean(input.designationId),
      customRoleId: clean(input.customRoleId),
      vehicleId: clean(input.vehicleId),
      supervisorId: clean(input.supervisorId),
      licenceExpiry: input.licenceExpiry ? new Date(input.licenceExpiry) : undefined,
      whatsapp: input.whatsapp || input.phone,
      platformAccess: input.platformAccess ?? defaultPlatformAccess(input.role),
      status: direct ? input.status : 'PENDING',
      passwordHash: await hashPassword(password),
      mustChangePassword: !input.password,
      createdBy: user.id,
    })
    if (input.role === 'DRIVER' && input.vehicleId) await Vehicle.updateOne({ _id: input.vehicleId }, { driverId: u._id })
    if (!direct) await Approval.create({ type: 'NEW_USER', userId: u._id, payload: { name: u.name, role: u.role }, requestedBy: user.id })
    await audit(user, 'user.create', 'user', u._id, { after: { employeeId: u.employeeId, name: u.name, role: u.role, platformAccess: u.platformAccess }, label: u.name }, clientMeta(req, user))
    return { id: String(u._id), temporaryPassword: input.password ? undefined : password, pendingApproval: !direct }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN', 'TRANSPORT_SUPERVISOR'] },
)
