import { Check, Info } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { CustomRole, User } from '@/lib/models'
import { ROLES, ROLE_LABEL, PERMISSIONS, type Permission, type Role } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Card } from '@/components/ui'
import { CustomRoleCard, NewRoleButton, type CustomRoleDoc } from '@/components/admin-settings/RolesClient'
import { PERMISSION_LABEL, PERM_KEYS } from '@/components/admin-settings/permissions'
import { cx } from '@/lib/format'

export const metadata = { title: 'Roles & permissions · Unico HomeCare' }

const SHORT: Record<Role, string> = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HC_ADMIN: 'HC_ADMIN',
  FRONT_DESK: 'FRONT_DESK',
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  ALLIED: 'ALLIED',
  DRIVER: 'DRIVER',
  TRANSPORT_SUPERVISOR: 'TRANSPORT_SUP.',
  VIEWER: 'VIEWER',
}
/** Permissions that only apply to the user's own / assigned records for these roles */
const LIMITED: Partial<Record<Permission, Role[]>> = {
  'messages.send': ['DOCTOR', 'NURSE', 'ALLIED'],
  'requests.create': ['DOCTOR', 'NURSE', 'ALLIED'],
}

function Yes({ limited }: { limited?: boolean }) {
  if (limited) return <span className="inline-flex h-[22px] items-center rounded-md bg-[#FEF3C7] px-1.5 text-[10.5px] font-bold text-[#B45309]">own</span>
  return (
    <span className="inline-flex size-[22px] items-center justify-center rounded-md bg-[#DCFCE7] text-[#15803D]">
      <Check size={14} strokeWidth={3} />
    </span>
  )
}
const No = () => <span className="inline-block size-1.5 rounded-full bg-slate-300" />

export default async function RolesPage() {
  await requireWebUser('users.manage')
  const [custom, counts] = await Promise.all([
    CustomRole.find({}).sort({ createdAt: 1 }).lean<any[]>(),
    User.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$role', n: { $sum: 1 } } }]),
  ])
  const nOf = (r: string) => counts.find((c) => c._id === r)?.n ?? 0
  const roles: CustomRoleDoc[] = plain(custom)
  const cols = `minmax(260px,1.6fr) repeat(${ROLES.length + roles.length}, minmax(84px,1fr))`

  return (
    <AdminPage
      title="Roles & permissions"
      crumbs="Settings"
      actions={
        <div className="hidden md:block">
          <NewRoleButton />
        </div>
      }
    >
      <div className="mb-4 flex items-start gap-2.5 rounded-card bg-white px-4 py-3 text-[13px] text-slate-600 shadow-card">
        <Info size={17} className="mt-px flex-none text-primary" />
        <span>
          Fixed roles are defined in code and enforced on every page and API call — this matrix is exactly what the app checks. <b className="text-slate-800">Custom roles are templates</b>: they document a permission set copied from a fixed role, but users still
          get a fixed base role until custom roles are wired into enforcement.
        </span>
      </div>

      <Card pad={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-fit px-5 pb-2">
            <div className="sticky top-0 grid items-end border-b border-slate-200 bg-white pb-3 pt-4" style={{ gridTemplateColumns: cols }}>
              <span className="text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">Capability</span>
              {ROLES.map((r) => (
                <span key={r} className="flex flex-col items-center gap-1 px-1 text-center" title={ROLE_LABEL[r]}>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">{SHORT[r]}</span>
                  <span className="text-[11px] text-slate-500">
                    {nOf(r)} user{nOf(r) === 1 ? '' : 's'}
                  </span>
                </span>
              ))}
              {roles.map((r) => (
                <span key={r._id} className="flex flex-col items-center gap-1 px-1 text-center" title={r.name}>
                  <span className="max-w-full truncate rounded bg-[#EDE9FE] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#6D28D9]">{r.code}</span>
                  <span className="text-[11px] text-slate-500">template</span>
                </span>
              ))}
            </div>
            {PERM_KEYS.map((p) => (
              <div key={p} className="grid min-h-11 items-center border-b border-slate-100 last:border-b-0" style={{ gridTemplateColumns: cols }}>
                <span className="py-2 pr-3">
                  <span className="block text-[13.5px] font-semibold">{PERMISSION_LABEL[p]}</span>
                  <span className="font-mono text-[10.5px] text-slate-400">{p}</span>
                </span>
                {ROLES.map((r) => (
                  <span key={r} className="flex justify-center">
                    {(PERMISSIONS[p] as readonly string[]).includes(r) ? <Yes limited={LIMITED[p]?.includes(r)} /> : <No />}
                  </span>
                ))}
                {roles.map((r) => (
                  <span key={r._id} className={cx('flex justify-center')}>
                    {r.permissions.includes(p) ? <Yes /> : <No />}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>
      <p className="mt-3 text-[12.5px] text-slate-500">
        <span className="mr-1 inline-flex h-[18px] items-center rounded bg-[#FEF3C7] px-1 text-[10px] font-bold text-[#B45309]">own</span> = own / assigned records only. Field staff only read requests where they are on the care team; the Viewer role sees masked phone numbers.
      </p>

      <div className="mb-3 mt-8 flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[15px] font-bold">Custom roles · {roles.length}</div>
          <div className="text-[13px] text-slate-500">Create one by copying a fixed role, then add or remove permissions.</div>
        </div>
        <div className="md:hidden">
          <NewRoleButton />
        </div>
      </div>
      {roles.length === 0 ? (
        <div className="rounded-card border-2 border-dashed border-slate-300 px-6 py-8 text-center text-[13px] text-slate-500">No custom roles yet. Use “New custom role” to copy a fixed role.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {roles.map((r) => (
            <CustomRoleCard key={r._id} role={r} />
          ))}
        </div>
      )}
    </AdminPage>
  )
}
