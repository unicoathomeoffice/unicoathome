import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { can, STATUS_COLORS } from '@/lib/constants'
import { sweep } from '@/lib/services/jobs'
import { dashboardData, type Escalation } from '@/lib/services/dashboard'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Bars, Card, HBars, Kpi } from '@/components/ui'
import { AutoRefresh, Countdown, Elapsed } from '@/components/client'
import { cx } from '@/lib/format'

export const metadata = { title: 'Dashboard · Unico HomeCare' }

type Data = Awaited<ReturnType<typeof dashboardData>>

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ density?: string }> }) {
  const user = await requireWebUser()
  const { density } = await searchParams
  const compact = density === 'compact'
  try {
    await sweep()
  } catch (e) {
    console.error('sweep failed', e)
  }
  const d = await dashboardData()
  const canAssign = can(user, 'requests.assign')

  const toggle = (
    <div className="hidden rounded-lg border border-slate-300 bg-white p-0.5 md:flex" role="group" aria-label="Density">
      {[
        { k: 'comfortable', label: 'Comfortable', href: '/dashboard' },
        { k: 'compact', label: 'Compact', href: '/dashboard?density=compact' },
      ].map((o) => (
        <Link
          key={o.k}
          href={o.href}
          scroll={false}
          className={cx('flex h-8 items-center rounded-md px-3 text-[13px] font-semibold', (compact ? 'compact' : 'comfortable') === o.k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}
        >
          {o.label}
        </Link>
      ))}
    </div>
  )

  const tiles = [
    { label: 'New', n: d.kpis.fresh.n, sub: d.kpis.fresh.sub, color: STATUS_COLORS.NEW[1], href: '/requests?status=NEW,VERIFIED' },
    { label: 'Confirmed', n: d.kpis.confirmed.n, sub: d.kpis.confirmed.sub, color: STATUS_COLORS.CONFIRMED[1], href: '/requests?status=CONFIRMED,RESCHEDULED' },
    { label: 'Assigned', n: d.kpis.assigned.n, sub: d.kpis.assigned.sub, color: STATUS_COLORS.ASSIGNED[1], href: '/requests?status=ASSIGNED,ACCEPTED' },
    { label: 'In progress', n: d.kpis.inProgress.n, sub: d.kpis.inProgress.sub, color: STATUS_COLORS.IN_PROGRESS[1], href: '/requests?status=EN_ROUTE,IN_PROGRESS' },
    { label: 'Completed', n: d.kpis.completed.n, sub: d.kpis.completed.sub, color: STATUS_COLORS.COMPLETED[1], href: '/requests?status=COMPLETED' },
    { label: 'Overdue', n: d.kpis.overdue.n, sub: d.kpis.overdue.sub, color: STATUS_COLORS.CANCELLED[1], href: '/requests?status=ACCEPTED,EN_ROUTE' },
    {
      label: 'Awaiting accept',
      n: d.kpis.awaiting.n,
      sub: d.kpis.awaiting.dueAt ? (
        <>
          <Countdown to={d.kpis.awaiting.dueAt} overdueClassName="font-semibold text-[#B91C1C]" /> left
        </>
      ) : (
        'none pending'
      ),
      color: STATUS_COLORS.ASSIGNED[1],
      href: '/requests?status=ASSIGNED',
    },
  ]

  return (
    <AdminPage title="Dashboard" actions={toggle}>
      <AutoRefresh seconds={30} />
      <div className={cx('flex min-h-full flex-col', compact ? 'gap-3' : 'gap-5')}>
        <div className={cx('grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7', compact ? 'gap-3' : 'gap-5')}>
          {tiles.map((t) => (
            <Kpi key={t.label} label={t.label} n={t.n} color={t.color} sub={compact ? undefined : t.sub} dense={compact} href={t.href} />
          ))}
        </div>

        {compact ? (
          <div className="grid flex-1 gap-3 lg:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr]">
            <Card pad={false} className="flex flex-col p-4 lg:col-span-2 xl:col-span-1">
              <Trend d={d} compact />
            </Card>
            <Card pad={false} className="p-4">
              <LivePanel d={d} compact canAssign={canAssign} />
            </Card>
            <Card pad={false} className="p-4">
              <div className="mb-3 text-[15px] font-bold">Completion by service · today</div>
              <HBars items={d.svcToday} labelWidth={150} />
              <div className="mb-3 mt-4 text-[15px] font-bold">Top zones · today</div>
              <HBars items={d.zonesToday} color="#3AB5A7" labelWidth={150} />
            </Card>
          </div>
        ) : (
          <>
            <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
              <Card className="flex flex-col">
                <Trend d={d} />
              </Card>
              <Card>
                <LivePanel d={d} canAssign={canAssign} />
              </Card>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <div className="mb-3.5 text-[15px] font-bold">Completion by service · this week</div>
                <HBars items={d.svcWeek.slice(0, 5)} />
              </Card>
              <Card>
                <div className="mb-3.5 text-[15px] font-bold">Top zones · this week</div>
                <HBars items={d.zonesWeek} color="#3AB5A7" />
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminPage>
  )
}

function Trend({ d, compact }: { d: Data; compact?: boolean }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[15px] font-bold">Requests per day · last 14 days</div>
        <div className="whitespace-nowrap text-[12px] text-slate-500">
          Total {d.trend.total} · avg {d.trend.avg}/day
        </div>
      </div>
      <div className={compact ? 'mt-4' : 'mt-5'}>
        <Bars values={d.trend.perDay} labels={d.trend.days.map((x) => String(Number(x.slice(8))))} height={compact ? 120 : 180} />
      </div>
      <div className={cx('grid grid-cols-2 border-t border-slate-100 sm:grid-cols-4', compact ? 'mt-3.5 gap-3 pt-3.5' : 'mt-6 gap-5 pt-5')}>
        {d.metrics.map((m) => (
          <div key={m.label}>
            <div className="text-[12px] text-slate-500">{m.label}</div>
            <div className={cx('mt-0.5 font-bold', compact ? 'text-xl' : 'text-2xl', m.bad && 'text-[#B91C1C]')}>{m.value}</div>
            <div className="text-[11px] text-slate-400">{m.target}</div>
          </div>
        ))}
      </div>
    </>
  )
}

function LivePanel({ d, compact, canAssign }: { d: Data; compact?: boolean; canAssign: boolean }) {
  return (
    <>
      <div className={cx('text-[15px] font-bold', compact ? 'mb-3' : 'mb-4')}>In progress now</div>
      {d.live.length ? (
        <div className="flex flex-col gap-3">
          {d.live.map((v) => (
            <Link key={v.id} href={`/requests/${v.id}`} className={cx('flex items-center gap-3 rounded-[10px] bg-slate-50 hover:bg-slate-100', compact ? 'px-3 py-2.5' : 'px-3.5 py-3')}>
              <Avatar name={v.patient} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{v.patient}</div>
                <div className="truncate text-[12px] text-slate-500">{v.line}</div>
              </div>
              <div className="text-right">
                {v.status === 'IN_PROGRESS' && v.checkInAt ? (
                  <>
                    <Elapsed from={v.checkInAt} className={cx('font-bold', compact ? 'text-[15px]' : 'text-[17px]', v.over ? 'text-[#B91C1C]' : 'text-[#B45309]')} />
                    <div className="text-[11px] text-slate-400">{v.planned} min</div>
                  </>
                ) : (
                  <>
                    <div className={cx('font-bold text-[#0E7490]', compact ? 'text-[15px]' : 'text-[17px]')}>En route</div>
                    <div className="text-[11px] text-slate-400">{v.eta ? `ETA ${v.eta}` : ''}</div>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[10px] bg-slate-50 px-4 py-5 text-center text-[13px] text-slate-500">No visits in progress right now</div>
      )}

      <div className={cx('text-[15px] font-bold', compact ? 'mb-2.5 mt-4' : 'mb-3 mt-6')}>Escalations</div>
      {d.escalations.length ? (
        <div className="flex flex-col gap-2.5">
          {d.escalations.map((e) => (
            <EscalationRow key={`${e.kind}-${e.id}`} e={e} compact={compact} canAssign={canAssign} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-[#F0FDF4] px-3 py-2.5 text-[13px] font-semibold text-[#15803D]">
          <CheckCircle2 size={16} /> Nothing needs attention — all within SLA
        </div>
      )}
    </>
  )
}

const ESC_TONE = { overdue: 'border-[#DC2626] bg-[#FEF2F2]', urgent: 'border-[#DC2626] bg-[#FEF2F2]', accept: 'border-[#F59E0B] bg-[#FFFBEB]' } as const
const smallBtn = 'inline-flex h-7 flex-none items-center justify-center whitespace-nowrap rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50'

function EscalationRow({ e, compact, canAssign }: { e: Escalation; compact?: boolean; canAssign: boolean }) {
  const reassign = e.action === 'reassign' && canAssign
  return (
    <div className={cx('flex items-start gap-2.5 rounded-lg border-l-[3px]', compact ? 'px-2.5 py-2' : 'px-3 py-2.5', ESC_TONE[e.kind])}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{e.title}</div>
        <div className="text-[12px] text-slate-500">
          {e.sub}
          {e.dueAt && <Countdown to={e.dueAt} overdueClassName="font-semibold text-[#B91C1C]" />}
          {e.subAfter}
        </div>
      </div>
      <Link href={reassign ? `/requests/${e.id}?assign=1` : `/requests/${e.id}`} className={smallBtn}>
        {reassign ? 'Reassign' : 'Open'}
      </Link>
    </div>
  )
}
