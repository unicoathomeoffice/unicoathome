import { Inbox, UsersRound, FilePlus2, Route, CalendarRange, NotebookPen, ShieldCheck, Truck, ChevronRight, Receipt } from 'lucide-react'
import { MScreen, MList, MRow } from '@/components/mobile'
import { AutoRefresh } from '@/components/client'
import { SlaPill, StatusChip, PriorityBadge } from '@/components/ui'
import { MiniKpi, SLabel, ageG } from '@/components/coord/ui'
import { requireDesk } from '@/components/coord/data'
import { HomecareRequest, Approval, CarePlan } from '@/lib/models'
import { can, ROLE_LABEL } from '@/lib/constants'
import { getSettings } from '@/lib/settings'
import { slaInfo } from '@/lib/services/requests'
import { dayRange, day, time, cx } from '@/lib/format'

export const metadata = { title: 'Admin' }

/** Admin hub (Admin tab) — counters for today and the coordinator's tools. */
export default async function AdminHub() {
  const user = await requireDesk()
  const { start, end } = dayRange()
  const [statusCounts, today, pendingApprovals, activePlans, open, settings] = await Promise.all([
    HomecareRequest.aggregate([{ $match: { deletedAt: null, status: { $in: ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'COMPLETED'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    HomecareRequest.find({ deletedAt: null, scheduledAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' } }).select('status').lean<any[]>(),
    can(user, 'approvals.decide') ? Approval.countDocuments({ status: 'PENDING' }) : Promise.resolve(0),
    CarePlan.countDocuments({ status: 'ACTIVE' }),
    HomecareRequest.find({ deletedAt: null, status: { $in: ['NEW', 'VERIFIED', 'CONFIRMED', 'ASSIGNED'] } })
      .select('requestNo status priority patientSnapshot services timeline assignment scheduledAt')
      .lean<any[]>(),
    getSettings(),
  ])
  const c = (s: string[]) => statusCounts.filter((x) => s.includes(x._id)).reduce((a, x) => a + x.n, 0)
  const toConfirm = c(['NEW', 'VERIFIED'])
  const toAssign = c(['CONFIRMED', 'RESCHEDULED'])
  const awaiting = c(['ASSIGNED'])
  const toClose = c(['COMPLETED'])
  const live = today.filter((r) => ['EN_ROUTE', 'IN_PROGRESS'].includes(r.status)).length
  const done = today.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length
  // Most urgent open items by SLA
  const attention = open
    .map((r) => ({ r, sla: slaInfo(r, settings) }))
    .filter((x) => x.sla && x.sla.tone !== 'g')
    .sort((a, b) => (a.sla!.tone === b.sla!.tone ? +new Date(a.sla!.dueAt ?? 0) - +new Date(b.sla!.dueAt ?? 0) : a.sla!.tone === 'r' ? -1 : 1))
    .slice(0, 4)

  const tools = [
    { href: '/m/admin/inbox', icon: Inbox, title: 'Request inbox', sub: 'Verify · confirm · assign · cancel', n: toConfirm + toAssign },
    { href: '/m/admin/patients', icon: UsersRound, title: 'Patient board', sub: 'Search by phone, UHID or name' },
    { href: '/m/new-request', icon: FilePlus2, title: 'New request', sub: 'Quick form · 2 minutes' },
    { href: '/m/route', icon: Route, title: 'Day route', sub: `All ${today.length} visits today on a map` },
    { href: '/m/care-plans', icon: CalendarRange, title: 'Care plans', sub: `${activePlans} active · recurring visits` },
    { href: '/m/notes', icon: NotebookPen, title: 'Notes & handover', sub: 'Team notes, patient notes' },
    ...(can(user, 'transport.manage') ? [{ href: '/m/trips', icon: Truck, title: 'Trips & fleet', sub: 'Car requests and drivers' }] : []),
    ...(can(user, 'approvals.decide') ? [{ href: '/settings/approvals', icon: ShieldCheck, title: 'Approvals', sub: 'Petty cash, reschedules, new users (web)', n: pendingApprovals }] : []),
  ]

  return (
    <MScreen title="Admin" sub={`${ROLE_LABEL[user.role]} · ${day(new Date())}`} tab="admin">
      <AutoRefresh seconds={30} />
      <div className="grid grid-cols-4 gap-2">
        <MiniKpi n={toConfirm} label="To confirm" color={toConfirm ? '#C2410C' : undefined} href="/m/admin/inbox?tab=new" active={toConfirm > 0} />
        <MiniKpi n={toAssign} label="To assign" color="#4338CA" href="/m/admin/inbox?tab=confirmed" />
        <MiniKpi n={awaiting} label="Awaiting" color="#6D28D9" href="/m/admin/inbox?tab=awaiting" />
        <MiniKpi n={toClose} label="To close" color="#15803D" href="#close" />
      </div>
      <div className="flex gap-2">
        <MiniKpi n={today.length} label="Visits today" />
        <MiniKpi n={live} label="Live now" color="#B45309" />
        <MiniKpi n={done} label="Done today" color="#15803D" />
      </div>

      {attention.length > 0 && (
        <>
          <SLabel right="by SLA">Needs attention</SLabel>
          <MList>
            {attention.map(({ r, sla }) => (
              <MRow key={String(r._id)} href={`/m/admin/requests/${r._id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="whitespace-nowrap text-[12px] font-bold text-slate-500">{r.requestNo}</span>
                    {r.priority !== 'ROUTINE' && <PriorityBadge priority={r.priority} />}
                  </div>
                  <div className="truncate text-[15px] font-semibold">
                    {r.patientSnapshot?.name} <span className="font-normal text-slate-500">· {ageG(r.patientSnapshot?.ageYears, r.patientSnapshot?.gender)}</span>
                  </div>
                  <div className="truncate text-[13px] text-slate-500">{(r.services ?? []).map((s: any) => s.name).join(', ')}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusChip status={r.status} sm />
                  {sla && <SlaPill tone={sla.tone} label={sla.label} />}
                </div>
              </MRow>
            ))}
          </MList>
        </>
      )}

      <SLabel>Tools</SLabel>
      <MList>
        {tools.map((t) => (
          <MRow key={t.href} href={t.href}>
            <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-primary-50 text-primary-700">
              <t.icon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{t.title}</div>
              <div className="truncate text-[13px] text-slate-500">{t.sub}</div>
            </div>
            {!!t.n && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#DC2626] px-1.5 text-[12px] font-bold text-white">{t.n}</span>}
            <ChevronRight size={18} className="text-slate-400" />
          </MRow>
        ))}
      </MList>

      <div id="close" />
      <ToClose />
    </MScreen>
  )
}

async function ToClose() {
  const rows = await HomecareRequest.find({ deletedAt: null, status: 'COMPLETED' }).select('requestNo patientSnapshot services timeline billing pettyCash').sort({ 'timeline.completedAt': 1 }).limit(8).lean<any[]>()
  if (!rows.length) return null
  return (
    <>
      <SLabel right={`${rows.length} completed`}>Ready to close</SLabel>
      <MList>
        {rows.map((r) => {
          const pc = (r.pettyCash ?? []).filter((p: any) => p.status === 'PENDING').length
          return (
            <MRow key={String(r._id)} href={`/m/admin/requests/${r._id}/close`}>
              <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-[#DCFCE7] text-[#15803D]">
                <Receipt size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{r.patientSnapshot?.name}</div>
                <div className="truncate text-[13px] text-slate-500">
                  {r.requestNo} · done {time(r.timeline?.completedAt)}
                  {r.billing?.status ? ` · ${r.billing.status === 'PAID' ? 'Paid' : 'Due'}` : ''}
                </div>
              </div>
              {pc > 0 && <span className={cx('rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-bold text-[#B45309]')}>{pc} petty cash</span>}
              <ChevronRight size={18} className="text-slate-400" />
            </MRow>
          )
        })}
      </MList>
    </>
  )
}

