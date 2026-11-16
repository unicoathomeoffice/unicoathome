import 'server-only'
import { z } from 'zod'
import { Department, HomecareRequest, User, isOid } from '../models'
import { audit, type Meta } from '../audit'
import { bad, forbidden, notFound } from '../api'
import { can } from '../constants'
import { notifyUsers } from '../messaging'
import type { SessionUser } from '../auth'

// Heads of department (HOD): a super admin names the heads of each department and the services it covers. A head sees
// the requests for those services and assigns staff from their own department, once the coordinator has confirmed the
// request. The coordinator can still change the team. The car side stays with the security / car supervisor.

const ASSIGNABLE = ['CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED']
const WAITING = ['VERIFIED', ...ASSIGNABLE]

export async function departmentsHeadedBy(userId: string) {
  return Department.find({ headIds: userId, isActive: { $ne: false } }).select('name code serviceCodes headIds').lean<any[]>()
}

/** The head's board: their departments, the requests for their services, and their staff with today's load. */
export async function hodBoard(user: SessionUser) {
  const deps = await departmentsHeadedBy(user.id)
  if (!deps.length) return { departments: [], requests: [], staff: [] }
  const codes = [...new Set(deps.flatMap((d) => d.serviceCodes ?? []))]
  const depIds = deps.map((d) => d._id)
  const [rows, staff] = await Promise.all([
    codes.length
      ? HomecareRequest.find({ deletedAt: null, status: { $in: WAITING }, 'services.code': { $in: codes } })
          .select('requestNo status priority scheduledAt preferred patientSnapshot services assignment')
          .sort({ scheduledAt: 1, createdAt: 1 })
          .limit(150)
          .lean<any[]>()
      : [],
    User.find({ departmentId: { $in: depIds }, status: 'ACTIVE', deletedAt: null }).select('name role availability photoUrl phone departmentId').sort({ name: 1 }).lean<any[]>(),
  ])
  const start = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 86_400_000)
  const today = await HomecareRequest.aggregate([
    { $match: { deletedAt: null, status: { $nin: ['CANCELLED'] }, scheduledAt: { $gte: start, $lt: end }, 'assignment.primaryStaffId': { $in: staff.map((s) => s._id) } } },
    { $group: { _id: '$assignment.primaryStaffId', n: { $sum: 1 } } },
  ])
  const ids = [...new Set(rows.flatMap((r) => [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])]).filter(Boolean).map(String))]
  const names = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean<any[]>() : []
  const nameOf = (id: unknown) => names.find((u) => String(u._id) === String(id))?.name ?? null
  return {
    departments: deps.map((d) => ({ id: String(d._id), name: d.name, serviceCodes: d.serviceCodes ?? [] })),
    requests: rows.map((r) => ({
      id: String(r._id),
      requestNo: r.requestNo,
      status: r.status,
      priority: r.priority,
      scheduledAt: r.scheduledAt ?? null,
      preferred: r.preferred ?? null,
      patient: r.patientSnapshot?.name ?? '',
      area: r.patientSnapshot?.area ?? null,
      services: (r.services ?? []).map((s: any) => s.name).filter(Boolean),
      lead: nameOf(r.assignment?.primaryStaffId),
      team: (r.assignment?.secondaryStaffIds ?? []).map(nameOf).filter(Boolean),
      canAssign: ASSIGNABLE.includes(r.status),
    })),
    staff: staff.map((s) => ({ id: String(s._id), name: s.name, role: s.role, availability: s.availability ?? null, photoUrl: s.photoUrl ?? null, phone: s.phone ?? null, today: today.find((t) => String(t._id) === String(s._id))?.n ?? 0 })),
  }
}

export const HodAssignInput = z.object({ primaryStaffId: z.string().refine(isOid), secondaryStaffIds: z.array(z.string().refine(isOid)).max(6).default([]), instructions: z.string().max(1000).optional() })

/** A head assigns their own staff to a request for their department's services (after the coordinator confirmed it). */
export async function hodAssign(r: any, input: z.infer<typeof HodAssignInput>, user: SessionUser, meta: Meta) {
  const deps = await departmentsHeadedBy(user.id)
  const codes = new Set(deps.flatMap((d) => d.serviceCodes ?? []))
  if (!deps.length) throw forbidden('You are not the head of a department')
  if (!(r.services ?? []).some((s: any) => codes.has(s.code))) throw forbidden('This request has none of your department’s services')
  if (!ASSIGNABLE.includes(r.status)) throw bad(r.status === 'NEW' || r.status === 'VERIFIED' ? 'The coordinator confirms the request first' : 'This visit can no longer be assigned')
  const ids = [input.primaryStaffId, ...input.secondaryStaffIds]
  const mine = await User.countDocuments({ _id: { $in: ids }, departmentId: { $in: deps.map((d) => d._id) }, status: 'ACTIVE' })
  if (mine !== new Set(ids).size) throw bad('Choose staff from your own department')
  const svc = await import('./requests')
  // the head acts with assign rights for this one step
  const actor = { ...user, grants: [...(user.grants ?? []), 'requests.assign'] } as SessionUser
  const out = await svc.assign(r, { ...input, secondaryStaffIds: input.secondaryStaffIds } as any, actor, meta)
  await audit(user, 'hod.assign', 'request', r._id, { after: { primary: input.primaryStaffId, others: input.secondaryStaffIds, departments: deps.map((d) => d.name) }, label: r.requestNo }, meta)
  return out
}

/** Every department with its heads and services (anyone signed in may read; super admin changes). */
export async function listDepartments() {
  const deps = await Department.find({ isActive: { $ne: false } }).select('name code serviceCodes headIds sortOrder').sort({ sortOrder: 1, name: 1 }).lean<any[]>()
  const heads = await User.find({ _id: { $in: deps.flatMap((d) => d.headIds ?? []) } }).select('name').lean<any[]>()
  return deps.map((d) => ({
    id: String(d._id),
    name: d.name,
    code: d.code ?? null,
    serviceCodes: d.serviceCodes ?? [],
    heads: (d.headIds ?? []).map((h: any) => ({ id: String(h), name: heads.find((u) => String(u._id) === String(h))?.name ?? 'Staff' })),
  }))
}

export const DepartmentSetup = z.object({ name: z.string().trim().min(2).max(80).optional(), headIds: z.array(z.string().refine(isOid)).max(10).optional(), serviceCodes: z.array(z.string().max(40)).max(80).optional() })

export async function setDepartment(id: string, input: z.infer<typeof DepartmentSetup>, user: SessionUser, meta: Meta) {
  if (!can(user, 'master.manage')) throw forbidden()
  if (!isOid(id)) throw notFound('Department')
  const d = await Department.findById(id)
  if (!d) throw notFound('Department')
  const before = { heads: (d.headIds ?? []).map(String), services: d.serviceCodes ?? [] }
  if (input.name) d.set('name', input.name)
  if (input.headIds) d.set('headIds', input.headIds)
  if (input.serviceCodes) d.set('serviceCodes', input.serviceCodes)
  await d.save()
  ;(await import('../cached')).forgetMaster()
  await audit(user, 'department.heads', 'department', d._id, { before, after: { heads: input.headIds, services: input.serviceCodes }, label: d.name }, meta)
  return { ok: true }
}

export const DepartmentNew = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().max(20).optional(),
  headIds: z.array(z.string().refine(isOid)).max(10).default([]),
  serviceCodes: z.array(z.string().max(40)).max(80).default([]),
})

/** A super admin adds a department (e.g. PGR, Security) with its heads and services. */
export async function createDepartment(input: z.infer<typeof DepartmentNew>, user: SessionUser, meta: Meta) {
  if (!can(user, 'master.manage')) throw forbidden()
  const name = input.name.replace(/\s+/g, ' ')
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (await Department.exists({ name: new RegExp(`^${esc}$`, 'i'), isActive: { $ne: false } })) throw bad(`${name} already exists`)
  const code = input.code?.toUpperCase() || name.replace(/[^A-Za-z0-9]+/g, '').slice(0, 6).toUpperCase() || undefined
  const d = await Department.create({ name, code, headIds: input.headIds, serviceCodes: input.serviceCodes, isActive: true })
  ;(await import('../cached')).forgetMaster()
  await audit(user, 'department.create', 'department', d._id, { after: { name, code, heads: input.headIds, services: input.serviceCodes }, label: name }, meta)
  return { id: String(d._id) }
}

/** A request for a department's services was confirmed: its heads hear about it, to assign their staff. */
export async function tellHeads(r: any) {
  const codes = (r.services ?? []).map((s: any) => s.code).filter(Boolean)
  if (!codes.length) return
  const deps = await Department.find({ serviceCodes: { $in: codes }, isActive: { $ne: false } }).select('headIds name').lean<any[]>()
  const heads = [...new Set(deps.flatMap((d) => (d.headIds ?? []).map(String)))]
  if (!heads.length) return
  await notifyUsers(heads, {
    type: 'ASSIGN_NEEDED',
    title: `Assign your staff · ${r.patientSnapshot?.name ?? r.requestNo}`,
    body: `${r.requestNo} · ${(r.services ?? []).map((s: any) => s.name).join(', ')}`,
    requestId: r._id,
    url: `/requests/${r._id}`,
    priority: r.priority === 'EMERGENCY' || r.priority === 'URGENT' ? 'high' : 'normal',
  })
}
