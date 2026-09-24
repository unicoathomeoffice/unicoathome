import Link from 'next/link'
import { Navigation, Route as RouteIcon } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { AutoRefresh } from '@/components/client'
import { StatusChip, Chips, Empty, MapPin, mapsUrl } from '@/components/ui'
import { shortName } from '@/components/coord/ui'
import { pointOf, roadKm, driveMin, project, directionsUrl } from '@/components/transport/geo'
import { requireAppUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { HomecareRequest, Patient, isOid } from '@/lib/models'
import { DESK_ROLES } from '@/lib/constants'
import { withPeople } from '@/lib/services/requests'
import { dayRange, day, time, dur } from '@/lib/format'

export const metadata = { title: 'Day route' }

const DONE = ['COMPLETED', 'CLOSED']

/** M20 Day route — today's visits in order with travel gaps, a schematic map and Navigate per stop. */
export default async function DayRoute({ searchParams }: { searchParams: Promise<{ staff?: string }> }) {
  const user = await requireAppUser()
  await db()
  const sp = await searchParams
  const admin = DESK_ROLES.includes(user.role)
  const { start, end } = dayRange()
  const f: Record<string, any> = { deletedAt: null, scheduledAt: { $gte: start, $lt: end }, status: { $nin: ['CANCELLED', 'RESCHEDULED'] } }
  const staffFilter = admin && sp.staff && isOid(sp.staff) ? sp.staff : null
  if (!admin) f.$or = [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }, { 'transport.driverId': user.id }]
  else if (staffFilter) f.$or = [{ 'assignment.primaryStaffId': staffFilter }, { 'assignment.secondaryStaffIds': staffFilter }]
  const rows = await HomecareRequest.find(f).select('requestNo status scheduledAt expectedDurationMin services patientId patientSnapshot assignment transport visit.checkIn visit.checkOut timeline').sort({ scheduledAt: 1 }).lean<any[]>()
  await withPeople(rows)
  const pts = await Patient.find({ _id: { $in: rows.map((r) => r.patientId) } }).select('address').lean<any[]>()
  const stops = rows.map((r) => {
    const a = pts.find((p) => String(p._id) === String(r.patientId))?.address ?? {}
    return { r, lat: a.lat as number | undefined, lng: a.lng as number | undefined, ll: pointOf(r.patientSnapshot?.area, a.lat, a.lng) }
  })
  const legs = stops.map((s, i) => (i === 0 ? null : roadKm(stops[i - 1].ll, s.ll)))
  const totalKm = Math.round(legs.reduce<number>((a, k) => a + (k ?? 0), 0) * 10) / 10
  const pos = project(stops.map((s) => s.ll))
  const firstOpen = stops.findIndex((s) => !DONE.includes(s.r.status))
  const colour = (i: number) => (DONE.includes(stops[i].r.status) ? '#16A34A' : i === firstOpen ? '#F59E0B' : '#7C3AED')

  // staff chips for coordinators (everyone with a visit today)
  let chips: { key: string; label: string; href: string }[] = []
  if (admin) {
    const all = await HomecareRequest.find({ deletedAt: null, scheduledAt: { $gte: start, $lt: end }, status: { $nin: ['CANCELLED', 'RESCHEDULED'] }, 'assignment.primaryStaffId': { $ne: null } }).select('assignment').lean<any[]>()
    await withPeople(all)
    const seen = new Map<string, string>()
    for (const r of all) if (r.primaryStaff) seen.set(r.primaryStaff.id, shortName(r.primaryStaff.name))
    chips = [{ key: 'all', label: 'Everyone', href: '/m/route' }, ...[...seen].map(([id, name]) => ({ key: id, label: name, href: `/m/route?staff=${id}` }))]
  }
  const open = stops.filter((s) => !DONE.includes(s.r.status))
  // travel lines only make sense for one person's route
  const single = !admin || !!staffFilter

  return (
    <MScreen
      title="Day route"
      sub={`${day(new Date())} · ${rows.length} visit${rows.length === 1 ? '' : 's'}${single ? ` · ${totalKm} km` : ' · all staff'}`}
      back={admin ? '/m/admin' : undefined}
      right={
        single && open.length > 0 && (
          <a href={directionsUrl(open.map((s) => ({ address: s.r.patientSnapshot?.address, lat: s.lat, lng: s.lng })))} target="_blank" rel="noreferrer" className="flex size-10 items-center justify-center text-primary" aria-label="Navigate the whole route">
            <Navigation size={22} />
          </a>
        )
      }
      tab={admin ? 'admin' : 'visits'}
      pad={false}
    >
      <AutoRefresh seconds={60} />
      <div
        className="relative h-[300px] bg-[#E5EEF2]"
        style={{ backgroundImage: 'linear-gradient(rgba(15,23,42,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,.06) 1px,transparent 1px)', backgroundSize: '28px 28px' }}
      >
        {single && pos.length > 1 && (
          <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={pos.map((p) => `${p.x},${p.y - 3}`).join(' ')} fill="none" stroke="#0090CA" strokeWidth="2.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {pos.map((p, i) => (
          <MapPin key={i} n={i + 1} x={p.x} y={p.y} color={colour(i)} />
        ))}
        <div className="absolute bottom-2.5 left-3 rounded-md bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Approximate positions · Dhaka</div>
      </div>
      <div className="grid gap-3 px-5 py-4">
        {chips.length > 1 && <Chips items={chips} active={staffFilter ?? 'all'} />}
        {!rows.length && <Empty icon={<RouteIcon size={26} />} title="No visits today" sub={admin ? 'Nothing scheduled for this filter today.' : 'Your assigned visits for today will show here in order.'} />}
        <div>
          {stops.map((s, i) => {
            const r = s.r
            const done = DONE.includes(r.status)
            const checkIn = r.visit?.checkIn?.at ?? r.timeline?.checkInAt
            const checkOut = r.visit?.checkOut?.at ?? r.timeline?.checkOutAt
            const next = stops[i + 1]
            const km = legs[i + 1]
            const gap = next ? Math.round((new Date(next.r.scheduledAt).getTime() - new Date(r.scheduledAt).getTime()) / 60000 - (r.expectedDurationMin ?? 45)) : 0
            const href = admin ? `/m/admin/requests/${r._id}` : `/m/visits/${r._id}`
            return (
              <div key={String(r._id)} className="grid grid-cols-[28px_1fr] gap-x-3">
                <div className="flex flex-col items-center">
                  <div className="flex size-7 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: colour(i) }}>
                    {i + 1}
                  </div>
                  {next && <div className={single ? 'w-0.5 flex-1 bg-slate-300' : 'mb-2 w-0.5 flex-1 bg-slate-200'} />}
                </div>
                <div className="pb-2">
                  <Link href={href} className="block">
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-[15px] font-semibold">{r.patientSnapshot?.name}</div>
                      <StatusChip status={r.status} sm />
                    </div>
                    <div className="text-[13px] text-slate-500">
                      {time(r.scheduledAt)} · {(r.services ?? []).map((x: any) => x.name).join(', ')} · {r.patientSnapshot?.area ?? '—'} · {done && checkIn ? `${time(checkIn)}–${time(checkOut)}` : dur(r.expectedDurationMin)}
                    </div>
                    {admin && r.primaryStaff && <div className="text-[12px] text-slate-400">{[r.primaryStaff, ...(r.secondaryStaff ?? [])].map((m: any) => shortName(m.name)).join(' + ')}</div>}
                  </Link>
                  {!done && (
                    <a href={mapsUrl(r.patientSnapshot?.address, s.lat, s.lng)} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-50 px-3 text-[13px] font-semibold text-primary-700">
                      <Navigation size={14} /> Navigate
                    </a>
                  )}
                </div>
                {next && single && (
                  <>
                    <div className="flex justify-center">
                      <div className="h-full w-0.5 bg-slate-300" />
                    </div>
                    <div className="flex items-center gap-1.5 pb-4 pt-2 text-[12px] text-slate-400">
                      <Navigation size={12} /> ~{driveMin(km ?? 1)} min · {km} km{gap > 0 ? ` · gap ${dur(gap)}` : gap < 0 ? ` · overlaps ${dur(-gap)}` : ''}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </MScreen>
  )
}
