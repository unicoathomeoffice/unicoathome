import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { can } from '@/lib/constants'
import { isoDay } from '@/lib/format'
import { scheduleDetail } from '@/lib/services/schedules'
import { AdminPage } from '@/components/admin/AdminPage'
import { StatusChip } from '@/components/ui'
import { ScheduleActions } from '@/components/schedule/ScheduleActions'
import { cx, relDay, time } from '@/lib/format'

export const metadata = { title: 'Schedule · Unico HomeCare' }

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** One repeating schedule: the rule, its visits (done and coming), the next planned dates, and the controls. */
export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireWebUser('requests.readAll')
  const { id } = await params
  const s = await scheduleDetail(id, user)
  const now = Date.now()
  const past = s.visits.filter((v) => v.at && new Date(v.at).getTime() <= now)
  const coming = s.visits.filter((v) => !v.at || new Date(v.at).getTime() > now)
  return (
    <AdminPage
      title={s.patient?.name ?? 'Schedule'}
      crumbs={
        <Link href="/schedules" className="hover:underline">
          Schedules
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl bg-gradient-to-br from-[#E0F2FE] to-white p-4 ring-1 ring-[#BAE6FD]">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0369A1]">
              <CalendarClock size={16} /> {s.status === 'ACTIVE' ? 'Active' : s.status === 'PAUSED' ? 'Paused' : 'Ended'} schedule
            </div>
            <div className="mt-1 text-[20px] font-bold text-slate-900">
              {s.rule} · {s.time}
            </div>
            <div className="mt-1 text-[13.5px] text-slate-600">
              {s.services.join(', ')}
              {s.patient?.area ? ` · ${s.patient.area}` : ''} · Team: {s.team.length ? s.team.join(', ') : 'not set — assign one visit and tick “every visit in this schedule”'}
              {s.car?.needed ? ` · Unico car${s.car.pickupTime ? ` (pick-up ${s.car.pickupTime})` : ''}` : ''}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70">
            <div className="mb-2 text-[15px] font-bold">Coming visits</div>
            {!coming.length && !s.upcoming.length ? (
              <div className="text-[13px] text-slate-500">Nothing coming.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {coming.map((v) => (
                  <li key={v.id} className={cx('flex items-center gap-3 py-2 text-[13.5px]', v.status === 'CANCELLED' && 'opacity-60')}>
                    <span className="w-36 flex-none font-semibold">{v.at ? `${relDay(v.at)} ${time(v.at)}` : '—'}</span>
                    <Link href={`/requests/${v.id}`} className="font-medium text-primary-700 hover:underline">
                      {v.requestNo}
                    </Link>
                    <span className="ml-auto">
                      <StatusChip status={v.status as any} sm />
                    </span>
                  </li>
                ))}
                {s.upcoming.map((d) => (
                  <li key={d} className="flex items-center gap-3 py-2 text-[13.5px] text-slate-500">
                    <span className="w-36 flex-none">{day(d)}</span>
                    <span className="italic">planned — made 2 weeks ahead</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70">
            <div className="mb-2 text-[15px] font-bold">Past visits · {past.length}</div>
            {!past.length ? (
              <div className="text-[13px] text-slate-500">None yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...past].reverse().map((v) => (
                  <li key={v.id} className={cx('flex items-center gap-3 py-2 text-[13.5px]', v.status === 'CANCELLED' && 'opacity-60')}>
                    <span className="w-36 flex-none">{v.at ? `${relDay(v.at)} ${time(v.at)}` : '—'}</span>
                    <Link href={`/requests/${v.id}`} className="font-medium text-primary-700 hover:underline">
                      {v.requestNo}
                    </Link>
                    <span className="ml-auto">
                      <StatusChip status={v.status as any} sm />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <ScheduleActions
          id={s.id}
          status={s.status}
          canManage={can(user, 'requests.manage')}
          pattern={s.pattern}
          end={s.end}
          time={s.time}
          dates={[...new Set([...coming.filter((v) => v.at && v.status !== 'CANCELLED').map((v) => isoDay(v.at!)), ...s.upcoming])].sort()}
        />
      </div>
    </AdminPage>
  )
}
