import Link from 'next/link'
import { Search, SlidersHorizontal, CalendarX2, X } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { AutoRefresh } from '@/components/client'
import { Chips, Empty } from '@/components/ui'
import { VisitCard, SectionLabel, SegLinks, FHeader, vHref } from '@/components/field'
import { RespondInline } from '@/components/field/visit'
import { teamFilter, isDesk } from '@/components/field/data'
import { requireAppUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { HomecareRequest, ServiceType } from '@/lib/models'
import { withPeople } from '@/lib/services/requests'
import { STATUS_LABEL, type Status } from '@/lib/constants'
import { cx, day, dayRange, isoDay, relDay } from '@/lib/format'

export const metadata = { title: 'Visits' }

const SEGS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
]
const ACTIVE = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS']
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'ASSIGNED', label: 'Awaiting accept' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'EN_ROUTE', label: 'En route' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
]
const CAT_LABEL: Record<string, string> = { Doctor: 'Doctor', Nursing: 'Nursing', Lab: 'Sample / lab', Physio: 'Physio', Other: 'Other' }

type SP = { seg?: string; q?: string; cat?: string; status?: string; f?: string; denied?: string }

/** M04 Visits · Today / Upcoming / Completed, search + filters, grouped by date */
export default async function Visits({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const user = await requireAppUser()
  await db()
  const seg = SEGS.some((s) => s.key === sp.seg) ? sp.seg! : 'today'
  const { start, end } = dayRange()
  const f: any = { deletedAt: null, status: { $nin: ['NEW', 'VERIFIED'] } }
  const and: any[] = []
  if (!isDesk(user.role)) and.push(teamFilter(user))
  if (seg === 'today') and.push({ $or: [{ scheduledAt: { $gte: start, $lt: end } }, { scheduledAt: { $lt: start }, status: { $in: ACTIVE } }] })
  else if (seg === 'upcoming') and.push({ scheduledAt: { $gte: end }, status: { $nin: ['NEW', 'VERIFIED', 'CANCELLED', 'COMPLETED', 'CLOSED'] } })
  else and.push({ status: { $in: ['COMPLETED', 'CLOSED'] }, scheduledAt: { $gte: new Date(Date.now() - 60 * 86400_000) } })
  if (sp.status && STATUS_FILTERS.some((s) => s.key === sp.status)) and.push({ status: sp.status === 'COMPLETED' ? { $in: ['COMPLETED', 'CLOSED'] } : sp.status })
  const types = await ServiceType.find({ isActive: { $ne: false } }).select('code category').lean<any[]>()
  const cats = [...new Set(types.map((t) => t.category).filter(Boolean))] as string[]
  if (sp.cat && cats.includes(sp.cat)) and.push({ 'services.code': { $in: types.filter((t) => t.category === sp.cat).map((t) => t.code) } })
  const q = sp.q?.trim()
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    and.push({ $or: [{ requestNo: rx }, { 'patientSnapshot.name': rx }, { 'patientSnapshot.phone': new RegExp(q.replace(/\D/g, '') || '^$') }, { 'patientSnapshot.area': rx }] })
  }
  if (and.length) f.$and = and
  const rows = await HomecareRequest.find(f)
    .select('-visit.notes -deviceStamps -clinical.notes -visit.vitals')
    .sort({ scheduledAt: seg === 'completed' ? -1 : 1 })
    .limit(150)
    .lean<any[]>()
  await withPeople(rows)
  const list = plain(rows)

  // group by Dhaka day
  const groups: { key: string; items: any[] }[] = []
  for (const r of list) {
    const k = r.scheduledAt ? isoDay(r.scheduledAt) : 'none'
    const g = groups.find((x) => x.key === k)
    if (g) g.items.push(r)
    else groups.push({ key: k, items: [r] })
  }
  const title = (k: string, items: any[]) => {
    if (k === 'none') return `Not scheduled · ${items.length}`
    const rd = relDay(items[0].scheduledAt)
    const d = day(items[0].scheduledAt)
    return `${rd === d ? d : `${rd} · ${d}`} · ${items.length} visit${items.length === 1 ? '' : 's'}`
  }
  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams()
    const m = { seg, q, cat: sp.cat, status: sp.status, f: sp.f, ...over }
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v)
    const s = p.toString()
    return `/m/visits${s ? `?${s}` : ''}`
  }
  const showStatus = sp.f === '1' || !!sp.status
  const isMine = (r: any) => [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].map(String).includes(user.id)

  return (
    <MScreen
      tab="visits"
      header={
        <FHeader
          title="Visits"
          sub={isDesk(user.role) ? 'All visits · coordinator view' : undefined}
          right={
            <Link href={href({ f: showStatus ? undefined : '1', status: showStatus ? undefined : sp.status })} className={cx('flex size-10 items-center justify-center rounded-lg border', showStatus ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700')} aria-label="Filters">
              <SlidersHorizontal size={18} />
            </Link>
          }
        />
      }
    >
      <Col>
      <AutoRefresh seconds={45} />
      {sp.denied && <div className="rounded-card bg-[#FEE2E2] px-4 py-3 text-[13px] font-semibold text-[#B91C1C]">You can only open visits assigned to your team.</div>}
      <SegLinks active={seg} items={SEGS.map((s) => ({ ...s, href: href({ seg: s.key, status: undefined }) }))} />
      <form action="/m/visits" className="flex h-11 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 focus-within:border-primary">
        <Search size={18} className="flex-none text-slate-400" />
        <input type="hidden" name="seg" value={seg} />
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <input name="q" defaultValue={q} placeholder="Search patient, request no" className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-slate-400" enterKeyHint="search" />
        {q && (
          <Link href={href({ q: undefined })} className="flex size-8 items-center justify-center text-slate-400" aria-label="Clear search">
            <X size={16} />
          </Link>
        )}
      </form>
      <Chips active={sp.cat ?? 'all'} items={[{ key: 'all', label: 'All services', href: href({ cat: undefined }) }, ...cats.map((c) => ({ key: c, label: CAT_LABEL[c] ?? c, href: href({ cat: c }) }))]} />
      {showStatus && (
        <Chips
          active={sp.status ?? 'all'}
          items={[{ key: 'all', label: 'All statuses', href: href({ status: undefined, f: '1' }) }, ...STATUS_FILTERS.map((s) => ({ key: s.key, label: s.label, href: href({ status: s.key }) }))]}
        />
      )}

      {groups.length ? (
        groups.map((g) => (
          <div key={g.key} className="grid gap-3">
            <SectionLabel className="mt-1">{title(g.key, g.items)}</SectionLabel>
            {g.items.map((r) => (
              <VisitCard
                key={r._id}
                r={r}
                href={vHref(r._id)}
                muted={['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status) || (r.status === 'ASSIGNED' && seg !== 'completed')}
                footer={
                  r.status === 'ASSIGNED' && isMine(r) ? (
                    <RespondInline r={r} primary={String(r.assignment?.primaryStaffId) === user.id} />
                  ) : isDesk(user.role) && r.primaryStaff ? (
                    <div className="truncate text-[12px] text-slate-500">
                      {r.primaryStaff.name} · {STATUS_LABEL[r.status as Status]}
                    </div>
                  ) : undefined
                }
              />
            ))}
          </div>
        ))
      ) : (
        <div className="rounded-card bg-white shadow-card">
          <Empty
            icon={<CalendarX2 size={26} />}
            title={q ? 'No matching visits' : seg === 'today' ? 'No visits today' : seg === 'upcoming' ? 'Nothing upcoming yet' : 'No completed visits'}
            sub={q ? 'Try a different name, phone or request number.' : 'Assigned visits appear here and as a notification.'}
          />
        </div>
      )}
      </Col>
    </MScreen>
  )
}
