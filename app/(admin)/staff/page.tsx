import Link from 'next/link'
import { UserRound } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { User, Department, Designation, Zone, Vehicle, Session, CustomRole } from '@/lib/models'
import { AVAILABILITY, AVAILABILITY_LABEL, ROLES, ROLE_LABEL, can, type Role } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Empty, Table, Tag, Tr } from '@/components/ui'
import { FilterSelect, SearchBox } from '@/components/people/filters'
import { AddUserButton, ImportCsvButton, UserOpenButton, UserRowMenu } from '@/components/people/StaffClient'
import type { StaffOptions, StaffUser } from '@/components/people/UserDrawer'
import { cx, dayNum, phone as fmtPhone, relDay, time } from '@/lib/format'

export const metadata = { title: 'Staff & users · Unico HomeCare' }

type SP = Promise<Record<string, string | undefined>>
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const AV_DOT: Record<string, string> = { ON_DUTY: '#16A34A', OFF_DUTY: '#94A3B8', ON_LEAVE: '#F59E0B' }

function lastLogin(d?: string) {
  if (!d) return <span className="text-slate-400">Never</span>
  const r = relDay(d)
  return r === 'Today' ? `Today ${time(d)}` : r === 'Yesterday' ? 'Yesterday' : dayNum(d)
}

export default async function StaffPage({ searchParams }: { searchParams: SP }) {
  const me = await requireWebUser('users.read')
  const sp = await searchParams
  const canManage = can(me, 'users.manage')

  const f: Record<string, any> = { deletedAt: null }
  if (sp.role) f.role = sp.role
  if (sp.status) f.status = sp.status
  if (sp.availability) f.availability = sp.availability
  if (sp.dept) f.departmentId = sp.dept
  if (sp.q?.trim()) {
    const q = esc(sp.q.trim())
    const digits = sp.q.replace(/\D/g, '')
    f.$or = [{ name: new RegExp(q, 'i') }, { employeeId: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }, { username: new RegExp(q, 'i') }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])]
  }

  const [users, all, departments, designations, zones, vehicles, supervisors, sessions, customRoles] = await Promise.all([
    User.find(f).sort({ status: 1, role: 1, name: 1 }).lean<any[]>(),
    User.find({ deletedAt: null }).select('status').lean<any[]>(),
    Department.find({}).sort({ sortOrder: 1, name: 1 }).lean<any[]>(),
    Designation.find({}).sort({ sortOrder: 1, title: 1 }).lean<any[]>(),
    Zone.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>(),
    Vehicle.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean<any[]>(),
    User.find({ role: 'TRANSPORT_SUPERVISOR', deletedAt: null }).select('name phone').lean<any[]>(),
    Session.aggregate([{ $match: { revokedAt: null, expiresAt: { $gt: new Date() } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
    CustomRole.find({}).sort({ name: 1 }).select('name code baseRole').lean<any[]>(),
  ])

  const options: StaffOptions = plain({
    departments: departments.filter((d) => d.isActive !== false).map((d) => ({ _id: d._id, name: d.name })),
    designations: designations.filter((d) => d.isActive !== false).map((d) => ({ _id: d._id, title: d.title, departmentId: d.departmentId })),
    zones: zones.map((z) => z.name),
    vehicles: vehicles.map((v) => ({ _id: v._id, name: v.name, plate: v.plate, driverId: v.driverId })),
    supervisors: supervisors.map((s) => ({ _id: s._id, name: s.name })),
    customRoles: customRoles.map((c) => ({ _id: c._id, name: c.name, code: c.code, baseRole: c.baseRole })),
  })
  const byId = <T extends { _id: unknown }>(list: T[], id: unknown) => (id ? list.find((x) => String(x._id) === String(id)) : undefined)
  const counts = {
    total: all.length,
    active: all.filter((u) => u.status === 'ACTIVE').length,
    pending: all.filter((u) => u.status === 'PENDING').length,
    suspended: all.filter((u) => u.status === 'SUSPENDED').length,
  }
  const COLS = 'minmax(200px,1.5fr) minmax(160px,1.2fr) minmax(110px,.9fr) 130px 84px 100px 120px 92px 44px'
  const filtered = !!(sp.q || sp.role || sp.status || sp.availability || sp.dept)

  return (
    <AdminPage
      title="Staff & users"
      actions={
        <div className="hidden items-center gap-2 md:flex">
          <ImportCsvButton options={options} canManage={canManage} />
          <AddUserButton options={options} canManage={canManage} />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBox placeholder="Name, ID, phone or email" className="w-full sm:w-[280px]" />
        <FilterSelect label="Role" param="role" options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <FilterSelect label="Department" param="dept" options={departments.map((d) => ({ value: String(d._id), label: d.name }))} />
        <FilterSelect label="Status" param="status" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'PENDING', label: 'Awaiting approval' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
        <FilterSelect label="Availability" param="availability" options={AVAILABILITY.map((a) => ({ value: a, label: AVAILABILITY_LABEL[a] }))} />
        <div className="flex-1" />
        <div className="flex items-center gap-2 md:hidden">
          <ImportCsvButton options={options} canManage={canManage} />
          <AddUserButton options={options} canManage={canManage} />
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 text-[13px] text-slate-500">
        <span className="font-semibold text-slate-900">{counts.total} users</span>
        <span>· {counts.active} active</span>
        {counts.pending > 0 && (
          <Link href="/settings/approvals?type=NEW_USER" className="font-semibold text-[#B45309]">
            · {counts.pending} awaiting approval
          </Link>
        )}
        <span>· {counts.suspended} suspended</span>
        {!canManage && <span className="ml-auto text-[12.5px]">Users you add are created as Pending until a super admin approves them.</span>}
      </div>

      <Table
        cols={COLS}
        head={['Name', 'Designation', 'Department', 'Role', 'Access', 'Availability', 'Status', 'Last login', '']}
        empty={
          <Empty
            icon={<UserRound size={24} />}
            title={filtered ? 'No users match these filters' : 'No users yet'}
            action={
              filtered ? (
                <Link href="/staff" className="text-sm font-semibold text-primary-700">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        }
      >
        {users.map((u) => {
          const desig = byId(designations, u.designationId)
          const dept = byId(departments, u.departmentId)
          const car = u.role === 'DRIVER' ? (vehicles.find((v) => String(v.driverId) === String(u._id)) ?? byId(vehicles, u.vehicleId)) : undefined
          const sup = u.role === 'DRIVER' ? byId(supervisors, u.supervisorId) : undefined
          const su: StaffUser = plain({ ...u, vehicleId: car?._id ?? u.vehicleId, passwordHash: undefined })
          const nSessions = sessions.find((s) => String(s._id) === String(u._id))?.n ?? 0
          return (
            <Tr key={String(u._id)} cols={COLS} className={cx(u.status === 'SUSPENDED' && 'bg-slate-50/70 text-slate-500')}>
              <UserOpenButton user={su} options={options} canManage={canManage} autoOpen={sp.edit === String(u._id)}>
                <Avatar name={u.name} size={32} tone={u.status === 'SUSPENDED' ? 'slate' : 'blue'} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900 hover:text-primary-700">{u.name}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">
                    {u.employeeId} · {fmtPhone(u.phone)}
                  </span>
                </span>
              </UserOpenButton>
              <span className="min-w-0">
                <span className="block truncate">
                  {desig?.title ?? <span className="text-slate-400">—</span>}
                  {car && <span className="text-slate-500"> · {car.name}</span>}
                </span>
                {u.role === 'DRIVER' && (
                  <span className="block truncate text-[11.5px] text-slate-500">
                    {car ? car.plate : 'No car'}
                    {sup ? ` · reports to ${sup.name}` : ''}
                  </span>
                )}
                {u.role !== 'DRIVER' && (u.skills ?? []).length > 0 && <span className="block truncate text-[11.5px] text-slate-500">{u.skills.join(', ')}</span>}
              </span>
              <span className="block truncate">{dept?.name ?? <span className="text-slate-400">—</span>}</span>
              <span>
                <span className="inline-flex h-[22px] items-center rounded-md bg-slate-100 px-1.5 font-mono text-[10.5px] font-bold text-slate-700" title={ROLE_LABEL[u.role as Role]}>
                  {u.role}
                </span>
              </span>
              <span className="whitespace-nowrap text-[13px]">{(u.platformAccess ?? []).map((a: string) => (a === 'web' ? 'Web' : 'App')).join(' · ') || '—'}</span>
              <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px]">
                <span className="size-2 rounded-full" style={{ background: AV_DOT[u.availability] ?? '#94A3B8' }} />
                {AVAILABILITY_LABEL[u.availability as keyof typeof AVAILABILITY_LABEL] ?? '—'}
              </span>
              <span>{u.status === 'ACTIVE' ? <Tag tone="green">Active</Tag> : u.status === 'PENDING' ? <Tag tone="amber">Awaiting approval</Tag> : <Tag tone="red">Suspended</Tag>}</span>
              <span className="whitespace-nowrap text-[13px]">{lastLogin(u.lastLoginAt)}</span>
              {canManage ? <UserRowMenu user={{ ...su, sessions: nSessions }} options={options} /> : <span />}
            </Tr>
          )
        })}
      </Table>
    </AdminPage>
  )
}
