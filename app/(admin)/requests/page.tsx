import { requireWebUser } from '@/lib/auth'
import { ACTIVE_STATUSES, can, PRIORITIES, STATUS_LABEL, STATUSES, type Status } from '@/lib/constants'
import { ServiceType, User, Zone } from '@/lib/models'
import { sweep } from '@/lib/services/jobs'
import { boardRows, type BoardFilters as Filters } from '@/lib/services/dashboard'
import { AdminPage } from '@/components/admin/AdminPage'
import { AutoRefresh } from '@/components/client'
import { BoardFilters } from '@/components/board/BoardFilters'
import { KanbanBoard } from '@/components/board/KanbanBoard'
import { RequestsTable } from '@/components/board/RequestsTable'

export const metadata = { title: 'Requests · Unico HomeCare' }

type SP = Filters & { view?: string }

export default async function RequestsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireWebUser('requests.readAll')
  const sp = await searchParams
  const view = sp.view === 'table' ? 'table' : 'kanban'
  try {
    await sweep()
  } catch (e) {
    console.error('sweep failed', e)
  }
  const filters: Filters = { status: sp.status, priority: sp.priority, service: sp.service, zone: sp.zone, staff: sp.staff, date: sp.date, q: sp.q }
  const [rows, services, zones, staff] = await Promise.all([
    boardRows(filters),
    ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name').lean<any[]>(),
    Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>(),
    User.find({ role: { $in: ['DOCTOR', 'NURSE', 'ALLIED'] }, status: 'ACTIVE', deletedAt: null }).sort({ name: 1 }).select('name').lean<any[]>(),
  ])
  const openCount = rows.filter((r) => ACTIVE_STATUSES.includes(r.status as Status)).length

  // Keep a custom value (e.g. a status list from a dashboard tile) selectable in the dropdown
  const withCurrent = (opts: { value: string; label: string }[], cur?: string, label?: (v: string) => string) =>
    cur && !opts.some((o) => o.value === cur) ? [...opts, { value: cur, label: label ? label(cur) : cur }] : opts
  const statusLabel = (v: string) => v.split(',').map((s) => STATUS_LABEL[s as Status] ?? s).join(' / ')

  const selects = [
    { key: 'status', label: 'Status', options: withCurrent([{ value: '', label: 'all' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))], sp.status, statusLabel) },
    { key: 'priority', label: 'Priority', options: [{ value: '', label: 'all' }, ...PRIORITIES.map((p) => ({ value: p, label: p[0] + p.slice(1).toLowerCase() }))] },
    { key: 'service', label: 'Service', options: withCurrent([{ value: '', label: 'all' }, ...services.map((s) => ({ value: s.code, label: s.name }))], sp.service) },
    { key: 'staff', label: 'Staff', options: withCurrent([{ value: '', label: 'all' }, ...staff.map((u) => ({ value: String(u._id), label: u.name }))], sp.staff, () => 'selected') },
    { key: 'zone', label: 'Zone', options: withCurrent([{ value: '', label: 'all' }, ...zones.map((z) => ({ value: z.name, label: z.name }))], sp.zone) },
    {
      key: 'date',
      label: 'Date',
      options: withCurrent(
        [
          { value: '', label: 'Any date' },
          { value: 'today', label: 'Today' },
          { value: 'tomorrow', label: 'Tomorrow' },
          { value: 'week', label: 'Next 7 days' },
        ],
        sp.date,
      ),
    },
  ]

  return (
    <AdminPage title={`Requests board · ${openCount} open`} className="flex flex-col gap-5">
      <AutoRefresh seconds={20} />
      <BoardFilters view={view} selects={selects} canCreate={can(user, 'requests.create')} rows={rows} />
      {view === 'table' ? (
        <RequestsTable rows={rows} canAssign={can(user, 'requests.assign')} canMessage={can(user, 'messages.send')} />
      ) : (
        <KanbanBoard rows={rows} canManage={can(user, 'requests.manage')} canAssign={can(user, 'requests.assign')} canCreate={can(user, 'requests.create')} />
      )}
    </AdminPage>
  )
}
