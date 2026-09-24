import Link from 'next/link'
import { CalendarRange, ChevronRight, Plus } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Chips, Empty, Progress, Tag } from '@/components/ui'
import { requireAppUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { DESK_ROLES } from '@/lib/constants'
import { listPlans, DAY_SHORT } from '@/lib/services/careplans'
import { relDay, time } from '@/lib/format'
import { ageG } from '@/components/coord/ui'

export const metadata = { title: 'Care plans' }

/** Care plans list — entry from the Admin hub. */
export default async function CarePlans({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requireAppUser('requests.create')
  await db()
  const sp = await searchParams
  const f = sp.f ?? 'active'
  const plans = await listPlans(user, { status: f === 'all' ? undefined : f === 'paused' ? 'PAUSED' : f === 'ended' ? 'ENDED' : 'ACTIVE' })
  const desk = DESK_ROLES.includes(user.role)
  return (
    <MScreen
      title="Care plans"
      sub={`${plans.length} ${f === 'all' ? '' : f} plan${plans.length === 1 ? '' : 's'}`.replace('  ', ' ')}
      back={desk ? '/m/admin' : '/m'}
      right={
        <Link href="/m/care-plans/new" className="flex size-10 items-center justify-center text-primary" aria-label="New care plan">
          <Plus size={24} />
        </Link>
      }
      tab={desk ? 'admin' : 'home'}
    >
      <Chips
        active={f}
        items={[
          { key: 'active', label: 'Active', href: '/m/care-plans' },
          { key: 'paused', label: 'Paused', href: '/m/care-plans?f=paused' },
          { key: 'ended', label: 'Ended', href: '/m/care-plans?f=ended' },
          { key: 'all', label: 'All', href: '/m/care-plans?f=all' },
        ]}
      />
      {!plans.length && <Empty icon={<CalendarRange size={26} />} title="No care plans here" sub="Create a plan for patients who need recurring visits — every occurrence becomes a normal request." action={<Link href="/m/care-plans/new" className="font-semibold text-primary-700">New care plan</Link>} />}
      {plans.map((p: any) => (
        <Link key={String(p._id)} href={`/m/care-plans/${p._id}`} className="block rounded-card bg-white px-4 py-3.5 shadow-card">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold">
                {p.patient?.name ?? 'Patient'} <span className="font-normal text-slate-500">· {ageG(p.patient?.ageYears, p.patient?.gender)}</span>
              </div>
              <div className="truncate text-[13px] text-slate-500">
                {p.title ?? p.service?.name} · {(p.daysOfWeek ?? []).map((d: number) => DAY_SHORT[d]).join(' · ')} · {p.slot ?? p.time}
              </div>
            </div>
            <Tag tone={p.status === 'ACTIVE' ? 'green' : p.status === 'PAUSED' ? 'amber' : 'slate'}>{p.status}</Tag>
            <ChevronRight size={18} className="mt-0.5 text-slate-400" />
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <Progress value={p.done} max={p.total} color="#16A34A" className="flex-1" />
            <span className="text-[12px] font-semibold text-slate-500">
              {p.done}/{p.total} done
            </span>
          </div>
          {p.nextAt && <div className="mt-1 text-[12px] text-slate-500">Next {relDay(p.nextAt)} {time(p.nextAt)}</div>}
        </Link>
      ))}
    </MScreen>
  )
}
