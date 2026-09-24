import Link from 'next/link'
import { Phone, FileText, UsersRound, CalendarRange, CheckCircle2, Plus } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Avatar, StatusChip, Chips, Empty, PriorityBadge, telUrl } from '@/components/ui'
import { SearchBox } from '@/components/coord/actions'
import { ageG, shortName } from '@/components/coord/ui'
import { requireDesk } from '@/components/coord/data'
import { Patient, HomecareRequest, CarePlan, User } from '@/lib/models'
import { ACTIVE_STATUSES, ZONES, can } from '@/lib/constants'
import { relDay, time, cx } from '@/lib/format'

export const metadata = { title: 'Patient board' }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** M16 Patient board — search by phone / UHID / name, filter chips, quick actions. */
export default async function PatientBoard({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const user = await requireDesk()
  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const f = sp.f ?? (q ? 'all' : 'action')

  const pf: Record<string, any> = { deletedAt: null }
  if (q) {
    const digits = q.replace(/\D/g, '')
    pf.$or = [{ name: new RegExp(esc(q), 'i') }, { uhid: new RegExp(`^${esc(q)}`, 'i') }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])]
  }
  if (f.startsWith('zone:')) pf['address.area'] = f.slice(5)

  const statusFilter: Record<string, any> = {
    action: { status: { $in: ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED'] } },
    urgent: { status: { $in: ACTIVE_STATUSES }, priority: { $in: ['URGENT', 'EMERGENCY'] } },
    active: { status: { $in: ACTIVE_STATUSES } },
  }
  const [activeIds] = await Promise.all([HomecareRequest.distinct('patientId', { deletedAt: null, status: { $in: ACTIVE_STATUSES } })])
  if (statusFilter[f]) {
    const ids = await HomecareRequest.distinct('patientId', { deletedAt: null, ...statusFilter[f] })
    pf._id = { $in: ids }
  }
  const patients = await Patient.find(pf).sort({ updatedAt: -1 }).limit(60).lean<any[]>()
  const pids = patients.map((p) => p._id)
  const [latest, upcoming, plans] = await Promise.all([
    HomecareRequest.aggregate([
      { $match: { patientId: { $in: pids }, deletedAt: null } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$patientId', id: { $first: '$_id' }, status: { $first: '$status' }, priority: { $first: '$priority' }, scheduledAt: { $first: '$scheduledAt' }, requestedAt: { $first: '$timeline.requestedAt' }, staff: { $first: '$assignment.primaryStaffId' }, n: { $sum: 1 } } },
    ]),
    HomecareRequest.aggregate([
      { $match: { patientId: { $in: pids }, deletedAt: null, status: { $in: ACTIVE_STATUSES }, scheduledAt: { $gte: new Date(Date.now() - 6 * 3600_000) } } },
      { $sort: { scheduledAt: 1 } },
      { $group: { _id: '$patientId', at: { $first: '$scheduledAt' }, staff: { $first: '$assignment.primaryStaffId' } } },
    ]),
    CarePlan.find({ patientId: { $in: pids }, status: { $in: ['ACTIVE', 'PAUSED'] } }).select('patientId status').lean<any[]>(),
  ])
  const staffIds = [...latest.map((l) => l.staff), ...upcoming.map((u) => u.staff)].filter(Boolean)
  const staff = await User.find({ _id: { $in: staffIds } }).select('name').lean<any[]>()
  const nameOf = (id: unknown) => shortName(staff.find((s) => String(s._id) === String(id))?.name)

  // Needs action first (by status), then most recent activity
  const rank: Record<string, number> = { NEW: 0, VERIFIED: 0, CONFIRMED: 1, RESCHEDULED: 1, ASSIGNED: 2, ACCEPTED: 3, EN_ROUTE: 3, IN_PROGRESS: 3, COMPLETED: 4 }
  const rows = patients
    .map((p) => ({ p, l: latest.find((x) => String(x._id) === String(p._id)), u: upcoming.find((x) => String(x._id) === String(p._id)), plan: plans.find((x) => String(x.patientId) === String(p._id)) }))
    .sort((a, b) => (rank[a.l?.status] ?? 9) - (rank[b.l?.status] ?? 9))

  const zonesInUse = ZONES.slice(0, 6)
  const chips = [
    { key: 'all', label: 'All', href: `/m/admin/patients?f=all${q ? `&q=${encodeURIComponent(q)}` : ''}` },
    { key: 'action', label: 'Needs action', href: `/m/admin/patients?f=action${q ? `&q=${encodeURIComponent(q)}` : ''}` },
    { key: 'urgent', label: 'Urgent', href: `/m/admin/patients?f=urgent${q ? `&q=${encodeURIComponent(q)}` : ''}` },
    { key: 'active', label: 'Active', href: `/m/admin/patients?f=active${q ? `&q=${encodeURIComponent(q)}` : ''}` },
    ...zonesInUse.map((z) => ({ key: `zone:${z}`, label: z, href: `/m/admin/patients?f=zone:${encodeURIComponent(z)}${q ? `&q=${encodeURIComponent(q)}` : ''}` })),
  ]
  const manage = can(user, 'requests.manage')
  const assign = can(user, 'requests.assign')
  const btn = 'flex h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 text-[13px] font-semibold text-primary-700 active:bg-slate-200'

  return (
    <MScreen
      title="Patient board"
      sub={`${activeIds.length} active patient${activeIds.length === 1 ? '' : 's'}`}
      back="/m/admin"
      right={
        <Link href="/m/new-request" className="flex size-10 items-center justify-center rounded-[10px] border border-slate-200 text-primary" aria-label="New request">
          <Plus size={20} />
        </Link>
      }
      tab="admin"
    >
      <SearchBox placeholder="Phone, UHID or name" />
      <Chips items={chips} active={f} />
      {!rows.length && <Empty icon={<UsersRound size={26} />} title={q ? `No patient matches “${q}”` : 'No patients here'} sub="Try another filter, or create a new request for a new patient." action={<Link href="/m/new-request" className="font-semibold text-primary-700">New request</Link>} />}
      {rows.map(({ p, l, u, plan }) => {
        const st = l?.status as string | undefined
        const nextLine = u?.at ? `${relDay(u.at)} ${time(u.at)}` : st && ['NEW', 'VERIFIED'].includes(st) ? `Requested ${time(l.requestedAt)}` : l?.scheduledAt ? `Last ${relDay(l.scheduledAt)}` : 'No visits yet'
        const who = u?.staff ? nameOf(u.staff) : st && ['CONFIRMED', 'RESCHEDULED', 'NEW', 'VERIFIED'].includes(st) && u?.at ? 'unassigned' : ''
        const reqHref = l ? `/m/admin/requests/${l.id}` : `/m/new-request?patientId=${p._id}`
        let fourth = { href: plan ? `/m/care-plans/${plan._id}` : `/m/care-plans/new?patientId=${p._id}`, label: 'Plan', icon: <CalendarRange size={15} /> }
        if (l && ['NEW', 'VERIFIED'].includes(st!) && manage) fourth = { href: `/m/admin/requests/${l.id}/confirm`, label: 'Confirm', icon: <CheckCircle2 size={15} /> }
        else if (l && ['CONFIRMED', 'RESCHEDULED', 'ASSIGNED'].includes(st!) && assign) fourth = { href: `/m/admin/requests/${l.id}/assign`, label: 'Assign', icon: <UsersRound size={15} /> }
        return (
          <div key={String(p._id)} className="rounded-card bg-white px-3.5 py-3 shadow-card">
            <Link href={reqHref} className="flex items-center gap-3">
              <Avatar name={p.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">
                  {p.name} <span className="font-normal text-slate-500">· {ageG(p.ageYears, p.gender)}</span>
                </div>
                <div className="text-[13px] leading-[18px] text-slate-500">
                  {[p.address?.area, nextLine, who].filter(Boolean).join(' · ')}
                  {p.uhid ? <span className="text-slate-400"> · UHID {p.uhid}</span> : null}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {st ? <StatusChip status={st} sm /> : <span className="text-[11px] font-bold text-slate-400">NO VISITS</span>}
                {l && l.priority !== 'ROUTINE' && ACTIVE_STATUSES.includes(st as any) && <PriorityBadge priority={l.priority} />}
                {plan && <span className={cx('text-[11px] font-bold', plan.status === 'ACTIVE' ? 'text-[#15803D]' : 'text-slate-400')}>Care plan</span>}
              </div>
            </Link>
            <div className="mt-2.5 flex gap-1.5">
              <a href={telUrl(p.phone)} className={btn}>
                <Phone size={15} /> Call
              </a>
              <a href={`https://wa.me/${(p.phone ?? '').replace(/\D/g, '').replace(/^0/, '880')}`} target="_blank" rel="noreferrer" className={btn}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                </svg>
                WhatsApp
              </a>
              <Link href={reqHref} className={btn}>
                <FileText size={15} /> Record
              </Link>
              <Link href={fourth.href} className={btn}>
                {fourth.icon} {fourth.label}
              </Link>
            </div>
          </div>
        )
      })}
    </MScreen>
  )
}
