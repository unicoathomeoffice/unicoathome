import Link from 'next/link'
import { Users } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { Zone, ServiceType, User } from '@/lib/models'
import { can, PRIORITIES, STATUSES, STATUS_LABEL, FIELD_ROLES } from '@/lib/constants'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Empty, PriorityBadge, StatusChip, Table, Tr } from '@/components/ui'
import { FilterSelect, SearchBox } from '@/components/people/filters'
import { ExportCsvButton, PatientRowActions } from '@/components/people/PatientActions'
import { PatientDrawerButton } from '@/components/people/PatientDrawer'
import { loadPatientBoard, maskPhone, type BoardRow } from '@/components/people/patient-board'
import { dayNum, phone as fmtPhone, relDay, time } from '@/lib/format'

export const metadata = { title: 'Patients · Unico HomeCare' }

const PAGE = 25
const COLS = 'minmax(190px,1.4fr) 140px 130px 124px minmax(110px,1fr) 96px 104px 164px'

type SP = Promise<Record<string, string | undefined>>

function nextVisit(c: BoardRow['current']) {
  if (!c) return <span className="text-slate-400">No requests yet</span>
  if (c.scheduledAt) return `${relDay(c.scheduledAt)} ${time(c.scheduledAt)}`
  if (c.preferredDate) return `${relDay(c.preferredDate)}${c.slot ? ` ${c.slot}` : ''}`
  return `Requested ${relDay(c.requestedAt) === 'Today' ? '' : dayNum(c.requestedAt) + ' '}${time(c.requestedAt)}`
}

export default async function PatientsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireWebUser('requests.readAll')
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const [rows, zones, services, staff] = await Promise.all([
    loadPatientBoard({ q: sp.q, zone: sp.zone, status: sp.status, priority: sp.priority, staff: sp.staff, service: sp.service }),
    Zone.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean<any[]>(),
    ServiceType.find({ isActive: true }).sort({ sortOrder: 1 }).select('code name').lean<any[]>(),
    User.find({ role: { $in: FIELD_ROLES }, status: 'ACTIVE', deletedAt: null }).sort({ name: 1 }).select('name').lean<any[]>(),
  ])
  const zoneNames = zones.map((z) => z.name as string)
  const masked = user.role === 'VIEWER'
  const canEdit = can(user, 'patients.edit')
  const canMessage = can(user, 'messages.send') && !masked
  const canCreate = can(user, 'requests.create')
  const active = rows.filter((r) => r.active).length
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const shown = rows.slice((page - 1) * PAGE, page * PAGE)
  const qs = (p: number) => {
    const n = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])
    n.set('page', String(p))
    return `/patients?${n}`
  }
  const filtered = !!(sp.q || sp.zone || sp.status || sp.priority || sp.staff || sp.service)

  return (
    <AdminPage title={`Patient board · ${active} active`}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBox placeholder="Phone, UHID or name" className="w-full sm:w-[230px]" />
        <FilterSelect label="Status" param="status" options={[{ value: 'ACTIVE', label: 'Any active' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })), { value: 'NONE', label: 'No requests' }]} />
        <FilterSelect label="Zone" param="zone" options={zoneNames.map((z) => ({ value: z, label: z }))} />
        <FilterSelect label="Staff" param="staff" options={[{ value: 'unassigned', label: 'Unassigned' }, ...staff.map((s) => ({ value: String(s._id), label: s.name }))]} />
        <FilterSelect label="Priority" param="priority" options={PRIORITIES.map((p) => ({ value: p, label: p[0] + p.slice(1).toLowerCase() }))} />
        <FilterSelect label="Service" param="service" options={services.map((s) => ({ value: s.code, label: s.name }))} />
        <div className="flex-1" />
        {!masked && <ExportCsvButton />}
        {canEdit && <PatientDrawerButton zones={zoneNames} />}
      </div>

      <Table
        cols={COLS}
        head={['Patient', 'Phone', 'Latest status', 'Next visit', 'Staff', 'Priority', 'Zone', 'Quick actions']}
        empty={
          <Empty
            icon={<Users size={24} />}
            title={filtered ? 'No patients match these filters' : 'No patients yet'}
            sub={filtered ? 'Try clearing a filter or searching by phone number.' : 'Register the first patient, or create a request — the patient is registered with it.'}
            action={
              filtered ? (
                <Link href="/patients" className="text-sm font-semibold text-primary-700">
                  Clear filters
                </Link>
              ) : canEdit ? (
                <PatientDrawerButton zones={zoneNames} />
              ) : undefined
            }
          />
        }
      >
        {shown.map((r) => {
          const c = r.current
          const text = `Assalamu alaikum ${r.name}, this is Unico Hospitals Home Care.${c && r.active ? ` About your ${c.service ?? 'home care'} visit ${c.requestNo}${c.scheduledAt ? ` on ${relDay(c.scheduledAt)} ${time(c.scheduledAt)}` : ''}: ` : ' '}`
          return (
            <Tr key={r.id} cols={COLS}>
              <Link href={`/patients/${r.id}`} className="flex min-w-0 items-center gap-2.5">
                <Avatar name={r.name} size={30} />
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-slate-900">{r.name}</span>
                  <span className="text-slate-500">
                    {' '}
                    {r.ageYears ?? ''} {r.gender ?? ''}
                  </span>
                  {r.uhid && <span className="block truncate text-[11.5px] text-slate-500">UHID {r.uhid}</span>}
                </span>
              </Link>
              <span className="whitespace-nowrap">{masked ? maskPhone(r.phone) : fmtPhone(r.phone)}</span>
              {c ? (
                <Link href={`/requests/${c.requestId}`} title={c.requestNo}>
                  <StatusChip status={c.status} sm />
                </Link>
              ) : (
                <span className="text-slate-400">—</span>
              )}
              <span className="whitespace-nowrap">{nextVisit(c)}</span>
              {c?.staffName ? (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={c.staffName} size={24} />
                  <span className="truncate">{c.staffName}</span>
                </span>
              ) : (
                <span className="text-slate-400">{c ? 'Unassigned' : '—'}</span>
              )}
              {c ? <PriorityBadge priority={c.priority} /> : <span className="text-slate-300">—</span>}
              <span className="block truncate">{r.zone ?? '—'}</span>
              <PatientRowActions id={r.id} name={r.name} phone={r.phone} text={text} canMessage={canMessage} canCreate={canCreate} />
            </Tr>
          )
        })}
      </Table>

      <div className="mt-3 flex items-center justify-between text-[13px] text-slate-500">
        <span>{masked ? 'Phone numbers are masked for the Viewer role' : `${rows.length} patient${rows.length === 1 ? '' : 's'}${filtered ? ' match' : ' registered'}`}</span>
        <span className="flex items-center gap-3">
          Showing {shown.length ? (page - 1) * PAGE + 1 : 0}–{(page - 1) * PAGE + shown.length} of {rows.length}
          {page > 1 && (
            <Link href={qs(page - 1)} className="font-semibold text-primary-700">
              Previous
            </Link>
          )}
          {page < pages && (
            <Link href={qs(page + 1)} className="font-semibold text-primary-700">
              Next
            </Link>
          )}
        </span>
      </div>
    </AdminPage>
  )
}
