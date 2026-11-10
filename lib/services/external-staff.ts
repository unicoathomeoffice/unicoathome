import 'server-only'
import { User } from '../models'
import { audit } from '../audit'
import { bad, notFound } from '../api'
import { hisEmployee, roleFromDesignation } from '../h360-staff'
import type { SessionUser } from '../auth'

type Meta = { ip?: string; userAgent?: string; client?: string }
const last10 = (p?: string | null) => (p ?? '').replace(/\D/g, '').slice(-10)

/**
 * Put a hospital employee from the HIS on a care team: reuse their HomeCare account when they already have one (same
 * employee ID or phone), otherwise add them as outside staff — active, on a team, but with no login (no password, no
 * platform access). Coordinators do the visit steps for them (lib/services/requests.ts).
 */
export async function addExternalStaff(employeeId: string, user: SessionUser, meta: Meta = {}) {
  const id = employeeId.trim()
  if (!/^[A-Za-z0-9-]{2,20}$/.test(id)) throw bad('Invalid employee ID')
  const existing = await User.findOne({ employeeId: id, deletedAt: null }).select('name role external status').lean<any>()
  if (existing) {
    if (existing.status !== 'ACTIVE') throw bad(`${existing.name} (${id}) has a HomeCare account that is not active — activate it under Staff first`)
    return { id: String(existing._id), name: existing.name, role: existing.role, external: !!existing.external, created: false }
  }
  const e = await hisEmployee(id)
  if (!e) throw notFound(`Employee ${id} in the HIS`)
  const ph = last10(e.phone)
  if (ph.length === 10) {
    const byPhone = await User.findOne({ phone: new RegExp(`${ph}$`), deletedAt: null }).select('name role external status employeeId').lean<any>()
    if (byPhone) {
      if (byPhone.status !== 'ACTIVE') throw bad(`${byPhone.name} (${byPhone.employeeId}) has this phone number but is not active`)
      return { id: String(byPhone._id), name: byPhone.name, role: byPhone.role, external: !!byPhone.external, created: false }
    }
  }
  const role = roleFromDesignation(e.designation)
  const u = await User.create({
    employeeId: e.employeeId,
    name: e.name,
    phone: ph.length === 10 ? `0${ph}` : `h360-${e.employeeId}`,
    whatsapp: ph.length === 10 ? `0${ph}` : undefined,
    role,
    status: 'ACTIVE',
    platformAccess: [],
    availability: 'ON_DUTY',
    external: true,
    source: 'H360',
    hisDesignation: e.designation,
    hisDepartment: e.department,
    createdBy: user.id,
  })
  await audit(user, 'user.create_external', 'user', u._id, { after: { employeeId: e.employeeId, name: e.name, role, designation: e.designation, department: e.department }, label: e.name }, meta)
  return { id: String(u._id), name: u.name, role, external: true, created: true }
}
