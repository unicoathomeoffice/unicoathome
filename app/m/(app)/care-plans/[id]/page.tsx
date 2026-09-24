import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MScreen, MCard, MList, MRow } from '@/components/mobile'
import { Avatar, StatusChip, Tag } from '@/components/ui'
import { SLabel, shortName } from '@/components/coord/ui'
import { PlanActions, AddPlanVisit } from '@/components/coord/CarePlan'
import { requireAppUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { isOid } from '@/lib/models'
import { DESK_ROLES } from '@/lib/constants'
import { planDetail, DAY_SHORT } from '@/lib/services/careplans'
import { isoDay, time, cx } from '@/lib/format'

export const metadata = { title: 'Care plan' }

const DONE = ['COMPLETED', 'CLOSED']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** P1 (6e) Care plan — header, counters, month calendar with dot states, next occurrences. */
export default async function CarePlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const user = await requireAppUser('requests.create')
  await db()
  const { id } = await params
  const sp = await searchParams
  if (!isOid(id)) notFound()
  const { plan, patient, service, requests, canManage } = await planDetail(id, user).catch(() => notFound())
  const desk = DESK_ROLES.includes(user.role)
  const today = isoDay()
  const live = requests.filter((r: any) => r.status !== 'CANCELLED')
  const byDay = new Map<string, any>()
  for (const r of live) if (r.scheduledAt) byDay.set(isoDay(r.scheduledAt), r)
  const doneN = live.filter((r: any) => DONE.includes(r.status)).length
  const todayN = live.filter((r: any) => r.scheduledAt && isoDay(r.scheduledAt) === today).length
  const upcoming = live.filter((r: any) => !DONE.includes(r.status) && r.scheduledAt && isoDay(r.scheduledAt) >= today)
  const future = live.filter((r: any) => ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED'].includes(r.status) && r.scheduledAt && new Date(r.scheduledAt).getTime() > Date.now()).length

  // month grid
  const [y, m] = (sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : today.slice(0, 7)).split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = first.getUTCDay()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)]
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const visitHref = (r: any) => (desk ? `/m/admin/requests/${r._id}` : `/m/visits/${r._id}`)
  const schedule = `Every ${(plan.daysOfWeek ?? []).map((d: number) => DAY_SHORT[d]).join(' · ')} · ${plan.slot ?? plan.time} · ${plan.weeks} week${plan.weeks === 1 ? '' : 's'}${plan.orderedBy ? ` · ordered by ${shortName(plan.orderedBy)}` : ''}`

  return (
    <MScreen
      title="Care plan"
      sub={`${patient?.name ?? 'Patient'} · ${plan.title ?? service?.name ?? ''}`}
      back={desk ? '/m/care-plans' : '/m'}
      right={<Tag tone={plan.status === 'ACTIVE' ? 'green' : plan.status === 'PAUSED' ? 'amber' : 'slate'}>{plan.status}</Tag>}
      bottom={canManage || desk ? <AddPlanVisit id={id} time={plan.time} disabled={plan.status !== 'ACTIVE'} /> : undefined}
      bottomNote={plan.status === 'PAUSED' ? 'Paused — resume the plan to add or re-create visits' : undefined}
    >
      <MCard>
        <div className="flex items-center gap-3">
          <Avatar name={patient?.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold">{service?.name ?? 'Service'}</div>
            <div className="text-[13px] leading-[18px] text-slate-500">{schedule}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            [live.length, 'visits'],
            [doneN, 'done'],
            [todayN, 'today'],
            [upcoming.filter((r: any) => isoDay(r.scheduledAt) > today).length, 'to go'],
          ].map(([n, l]) => (
            <div key={l as string} className="rounded-[10px] bg-slate-100 py-2 text-center">
              <div className="text-[19px] font-bold leading-6">{n}</div>
              <div className="text-[12px] text-slate-500">{l}</div>
            </div>
          ))}
        </div>
      </MCard>
      {canManage && <PlanActions id={id} status={plan.status} title={plan.title} orderedBy={plan.orderedBy} future={future} />}

      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Link href={`/m/care-plans/${id}?m=${prev}`} scroll={false} replace className="flex size-8 items-center justify-center rounded-md text-slate-500" aria-label="Previous month">
            <ChevronLeft size={18} />
          </Link>
          <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">
            {MONTHS[m - 1]} {y !== Number(today.slice(0, 4)) ? y : ''}
          </div>
          <Link href={`/m/care-plans/${id}?m=${next}`} scroll={false} replace className="flex size-8 items-center justify-center rounded-md text-slate-500" aria-label="Next month">
            <ChevronRight size={18} />
          </Link>
        </div>
        <div className="text-[12px] text-slate-500">tap a day to open the visit</div>
      </div>
      <MCard pad="px-3 py-3">
        <div className="grid grid-cols-7 gap-y-1.5 text-center">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="pb-1 text-[12px] font-semibold text-slate-400">
              {d}
            </div>
          ))}
          {cells.map((c, i) => {
            if (!c) return <div key={i} />
            const r = byDay.get(c)
            const n = Number(c.slice(8))
            const isToday = c === today
            const cls = cx(
              'mx-auto flex size-10 items-center justify-center rounded-lg text-[14px]',
              r && DONE.includes(r.status) && 'bg-[#DCFCE7] font-bold text-[#15803D]',
              r && !DONE.includes(r.status) && !isToday && 'bg-[#E0E7FF] font-bold text-[#4338CA]',
              isToday && (r ? 'bg-primary font-bold text-white' : 'font-bold text-primary ring-[1.5px] ring-primary'),
              !r && !isToday && 'text-slate-700',
            )
            return r ? (
              <Link key={i} href={visitHref(r)} className={cls}>
                {n}
              </Link>
            ) : (
              <div key={i} className={cls}>
                {n}
              </div>
            )
          })}
        </div>
        <div className="mt-2.5 flex gap-4 px-1 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[#DCFCE7]" />
            Done
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" />
            Today
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[#E0E7FF]" />
            Planned
          </span>
        </div>
      </MCard>

      <SLabel right={`${upcoming.length} upcoming`}>Next occurrences</SLabel>
      {upcoming.length ? (
        <MList>
          {upcoming.slice(0, 8).map((r: any) => (
            <MRow key={String(r._id)} href={visitHref(r)}>
              <div className="w-[64px] flex-none">
                <div className="text-[15px] font-bold">{new Date(r.scheduledAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Dhaka' })}</div>
                <div className="text-[12px] text-slate-500">{time(r.scheduledAt)}</div>
              </div>
              <div className={cx('min-w-0 flex-1 truncate text-[14px]', r.primaryStaff ? 'text-slate-800' : 'text-slate-400')}>{r.primaryStaff ? [r.primaryStaff, ...(r.secondaryStaff ?? [])].map((x: any) => shortName(x.name)).join(' + ') : 'unassigned'}</div>
              <StatusChip status={r.status} sm />
            </MRow>
          ))}
        </MList>
      ) : (
        <MCard className="text-[14px] text-slate-500">No upcoming visits in this plan.</MCard>
      )}
      {requests.some((r: any) => r.status === 'CANCELLED') && <div className="text-center text-[12px] text-slate-400">{requests.filter((r: any) => r.status === 'CANCELLED').length} cancelled occurrence(s) hidden</div>}
    </MScreen>
  )
}
