import 'server-only'
import { randomInt } from 'node:crypto'
import { Session, User } from '../models'
import { audit } from '../audit'
import { bad, notFound } from '../api'
import { hashPassword, type SessionUser } from '../auth'
import { hisEmployee, roleFromDesignation } from '../h360-staff'
import { baseUrl } from '../links'

type Meta = { ip?: string; userAgent?: string; client?: string }
const last10 = (p?: string | null) => (p ?? '').replace(/\D/g, '').slice(-10)

type Added = { id: string; name: string; role: string; external: boolean; created: boolean; hasLogin: boolean; loginSent?: boolean; pin?: string }

/**
 * Put a hospital employee from the HIS on a visit (supporting staff): reuse their HomeCare account when they already
 * have one (same employee ID or phone), otherwise add them from the HIS. With `appAccess` they also get a login to the
 * HomeCare phone app (employee ID + a temporary 6-digit PIN, sent on WhatsApp — through the Outbox like every message);
 * without it they are outside staff with no login and the coordinator does their visit steps.
 */
export async function addExternalStaff(employeeId: string, user: SessionUser, meta: Meta = {}, opts: { appAccess?: boolean } = {}): Promise<Added> {
  const id = employeeId.trim()
  if (!/^[A-Za-z0-9-]{2,20}$/.test(id)) throw bad('Invalid employee ID')
  let u = await User.findOne({ employeeId: id, deletedAt: null }).select('name role external status platformAccess phone whatsapp employeeId')
  if (!u) {
    const e = await hisEmployee(id)
    if (!e) throw notFound(`Employee ${id} in the HIS`)
    const ph = last10(e.phone)
    if (ph.length === 10) u = await User.findOne({ phone: new RegExp(`${ph}$`), deletedAt: null }).select('name role external status platformAccess phone whatsapp employeeId')
    if (!u) {
      const role = roleFromDesignation(e.designation)
      u = await User.create({
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
      if (opts.appAccess) return { ...(await grantAppLogin(u, user, meta)), created: true }
      return { id: String(u._id), name: u.name, role, external: true, created: true, hasLogin: false }
    }
  }
  if (u.status !== 'ACTIVE') throw bad(`${u.name} (${u.employeeId ?? id}) has a HomeCare account that is not active — activate it under Staff first`)
  const hasLogin = (u.platformAccess ?? []).includes('app') || (u.platformAccess ?? []).includes('web')
  if (opts.appAccess && !hasLogin) return { ...(await grantAppLogin(u, user, meta)), created: false }
  return { id: String(u._id), name: u.name, role: u.role, external: !!u.external, created: false, hasLogin }
}

/**
 * Give someone from the HIS a login to the HomeCare phone app: a temporary 6-digit PIN (must be changed after the first
 * sign-in), sent to their WhatsApp. They then do their own visit steps and see only the visits they are on.
 */
export async function grantAppLogin(u: any, user: SessionUser, meta: Meta = {}): Promise<Omit<Added, 'created'>> {
  const pin = String(randomInt(100000, 1000000))
  u.passwordHash = await hashPassword(pin)
  u.mustChangePassword = true
  u.platformAccess = [...new Set([...(u.platformAccess ?? []), 'app'])]
  u.external = false // they use the app themselves now
  await u.save()
  await Session.updateMany({ userId: u._id, revokedAt: null }, { revokedAt: new Date() })
  await audit(user, 'user.app_access_granted', 'user', u._id, { after: { platformAccess: u.platformAccess, temporaryPin: true }, label: u.name }, meta)
  const to = u.whatsapp || (/^0\d{10}$/.test(u.phone ?? '') ? u.phone : null)
  if (to) {
    const { queueWhatsApp } = await import('../wa/service')
    const first = String(u.name).replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(' ')[0]
    const text = [
      `Dear ${first}, you have been added to Unico @ Home (home care) as supporting staff.`,
      `Open the HomeCare app: ${baseUrl()}/m/login`,
      `Employee ID: ${u.employeeId}`,
      `Temporary PIN: ${pin}`,
      'Please change the PIN after you sign in (Profile → Change password). You will see the visits you are on.',
      `— ${user.name}, Unico HomeCare`,
    ].join('\n')
    await queueWhatsApp({ to, toName: `${u.name} (login)`, text, templateKey: 'staff_login', initiatedBy: user.id })
  }
  // no WhatsApp number: the admin is shown the PIN once to pass on
  return { id: String(u._id), name: u.name, role: u.role, external: false, hasLogin: true, loginSent: !!to, ...(to ? {} : { pin }) }
}
