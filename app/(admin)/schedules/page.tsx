import Link from 'next/link'
import { CalendarClock, Car } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { listSchedules } from '@/lib/services/schedules'
import { AdminPage } from '@/components/admin/AdminPage'
import { Empty } from '@/components/ui'
import { cx, relDay, time } from '@/lib/format'

export const metadata = { title: 'Schedules · Unico HomeCare' }

const TONE: Record<string, string> = { ACTIVE: 'bg-[#DCFCE7] text-[#15803D]', PAUSED: 'bg-[#FEF3C7] text-[#B45309]', ENDED: 'bg-slate-100 text-slate-500' }

/** Repeating schedules: every patient on regular visits, the rule, the next visit and progress. */
export default async function SchedulesPage() {
  const user = await requireWebUser('requests.readAll')
  const items = await listSchedules(user)
  const active = items.filter((i) => i.status === 'ACTIVE').length
  return (
    <AdminPage title="Schedules" crumbs={`${active} active · repeating visits are made 2 weeks ahead`}>
      {!items.length ? (
        <Empty
          icon={<CalendarClock size={24} />}
          title="No repeating schedules yet"
          sub="On New request choose “Repeating”, or open any request and use “Repeat on a schedule”."
          action={
            <Link href="/requests/new" className="text-sm font-semibold text-primary-700">
              New request
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((s) => (
            <Link key={s.id} href={`/schedules/${s.id}`} className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-[#0EA5E9] to-[#0284C7] text-white">
                  <CalendarClock size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-slate-900">{s.patient?.name ?? 'Patient'}</div>
                  <div className="truncate text-[12.5px] text-slate-500">{[s.services.join(', '), s.patient?.area].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={cx('flex-none rounded-full px-2 py-0.5 text-[11px] font-bold', TONE[s.status] ?? TONE.ENDED)}>{s.status === 'ACTIVE' ? 'Active' : s.status === 'PAUSED' ? 'Paused' : 'Ended'}</span>
              </div>
              <div className="text-[13.5px] font-semibold text-[#0369A1]">
                {s.rule} · {s.time}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                <span>Next: {s.nextAt ? `${relDay(s.nextAt)} ${time(s.nextAt)}` : '—'}</span>
                <span>
                  Done {s.done}
                  {s.total ? ` of ${s.total}` : ''}
                </span>
                <span>Team: {s.team ?? <span className="text-[#B45309]">not set</span>}</span>
                {s.car && (
                  <span className="flex items-center gap-1">
                    <Car size={12} /> car
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AdminPage>
  )
}
