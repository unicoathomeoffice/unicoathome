import Link from 'next/link'
import { Bell, Check, ChevronRight, Clock, Navigation, Phone, Truck } from 'lucide-react'
import { MScreen, MList, MRow } from '@/components/mobile'
import { AutoRefresh, UnreadBadge } from '@/components/client'
import { Empty, StatusChip, mapsUrl, telUrl } from '@/components/ui'
import { MiniKpi, SLabel, SignedInHeader, ALink, shortName } from '@/components/coord/ui'
import { OwnTransportButton, LegButton } from '@/components/transport/actions'
import { requireTransport, fleet, carNow, tripWindow } from '@/components/transport/data'
import { roadKm, driveMin, pointOf, HOSPITAL_LL } from '@/components/transport/geo'
import { HomecareRequest, Notification, Vehicle, Patient } from '@/lib/models'
import { ROLE_LABEL, TRANSPORT_MODE_LABEL } from '@/lib/constants'
import { withPeople } from '@/lib/services/requests'
import type { SessionUser } from '@/lib/auth'
import { dayRange, isoDay, time, day, relDay, cx } from '@/lib/format'

export const metadata = { title: 'Trips' }

/** S4 (5e) car supervisor home · D1 (6a) driver trips — one URL, role-dependent. */
export default async function TripsPage() {
  const user = await requireTransport()
  const unread = await Notification.countDocuments({ userId: user.id, readAt: null })
  const bell = (
    <Link href="/m/notifications" className="relative flex size-10 items-center justify-center rounded-[10px] border border-slate-200 text-slate-700" aria-label="Notifications">
      <Bell size={20} />
      <UnreadBadge initial={unread} className="absolute -right-1 -top-1" />
    </Link>
  )
  return user.role === 'DRIVER' ? <DriverTrips user={user} bell={bell} /> : <SupervisorTrips user={user} bell={bell} />
}

// ------------------------------------------------------------------ S4 supervisor
async function SupervisorTrips({ user, bell }: { user: SessionUser; bell: React.ReactNode }) {
  const today = dayRange()
  const tomorrow = dayRange(isoDay(Date.now() + 86400_000))
  const [cars, rows, doneToday] = await Promise.all([
    fleet(),
    HomecareRequest.find({ deletedAt: null, 'transport.needed': true, status: { $in: ['CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS'] }, scheduledAt: { $gte: today.start, $lt: tomorrow.end } })
      .select('requestNo status priority scheduledAt expectedDurationMin patientSnapshot services assignment transport')
      .sort({ scheduledAt: 1 })
      .lean<any[]>(),
    HomecareRequest.countDocuments({ deletedAt: null, 'transport.status': 'DONE', scheduledAt: { $gte: today.start, $lt: today.end } }),
  ])
  await withPeople(rows)
  const toAssign = rows.filter((r) => !r.transport?.status || r.transport.status === 'REQUESTED')
  const onTrip = rows.filter((r) => r.transport?.status === 'IN_TRIP').length
  const free = cars.filter((c) => c.state === 'FREE').length
  const now = Date.now()
  const groups = [
    { key: 'today', label: `Today · ${day(today.start)}`, rows: rows.filter((r) => new Date(r.scheduledAt) < today.end) },
    { key: 'tomorrow', label: `Tomorrow · ${day(tomorrow.start)}`, rows: rows.filter((r) => new Date(r.scheduledAt) >= today.end) },
  ]
  const order = (r: any) => (!r.transport?.status || r.transport.status === 'REQUESTED' ? 0 : r.transport.status === 'IN_TRIP' ? 1 : 2)
  const isAdmin = user.role !== 'TRANSPORT_SUPERVISOR'
  return (
    <MScreen header={<SignedInHeader initials={user.initials} name={user.name} sub={`${ROLE_LABEL[user.role]} · Transport · ${user.employeeId}`} right={bell} />} tab={isAdmin ? 'admin' : 'trips'}>
      <AutoRefresh seconds={30} />
      <div className="flex gap-2">
        <MiniKpi n={toAssign.length} label="To assign" color="#C2410C" active={toAssign.length > 0} />
        <MiniKpi n={onTrip} label="On trip" color="#0E7490" />
        <MiniKpi n={doneToday} label="Done today" color="#15803D" />
        <MiniKpi n={`${free}/${cars.length}`} label="Cars free" href="/m/fleet" />
      </div>
      <SLabel right={<Link href="/m/fleet" className="font-semibold text-primary-700">Fleet</Link>}>Fleet now</SLabel>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        {cars.map((c) => (
          <Link key={c.id} href="/m/fleet" className="w-[82px] min-w-[82px] flex-1 rounded-[10px] bg-white px-2 py-2.5 shadow-card">
            <div className="text-[13px] font-bold">{c.name}</div>
            <div className="truncate text-[10px] text-slate-500">{c.plate}</div>
            <div className={cx('mt-1.5 flex h-5 min-w-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold', c.state === 'FREE' ? 'bg-[#DCFCE7] text-[#15803D]' : c.state === 'ON_TRIP' ? 'bg-[#CFFAFE] text-[#0E7490]' : 'bg-slate-100 text-slate-500')} title={carNow(c)}>
              <span className="truncate">{carNow(c)}</span>
            </div>
          </Link>
        ))}
      </div>
      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <div key={g.key} className="grid gap-2.5">
            <SLabel>Trip requests · {g.label}</SLabel>
            {[...g.rows]
              .sort((a, b) => order(a) - order(b) || +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
              .map((r) => {
                const id = String(r._id)
                const st = r.transport?.status
                const byAt = new Date(r.scheduledAt).getTime() - 2 * 3600_000
                const left = (byAt - now) / 60000
                const tone = left < 0 ? 'bg-[#FEE2E2] text-[#B91C1C]' : left < 90 ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#DCFCE7] text-[#15803D]'
                const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
                const km = roadKm(HOSPITAL_LL, pointOf(r.patientSnapshot?.area))
                return (
                  <div key={id} className="rounded-card bg-white px-3.5 py-3 shadow-card">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[12px] font-bold text-slate-500">
                        {r.requestNo} · {r.patientSnapshot?.area ?? '—'}
                      </div>
                      {!st || st === 'REQUESTED' ? (
                        <span className={cx('inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-bold', tone)}>
                          <Clock size={12} strokeWidth={2.5} /> Assign car by {time(byAt)}
                        </span>
                      ) : st === 'OWN' ? (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-slate-100 px-2 text-[10.5px] font-bold uppercase text-slate-600">Own · {TRANSPORT_MODE_LABEL[r.transport.mode as keyof typeof TRANSPORT_MODE_LABEL]}</span>
                      ) : (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-[#CFFAFE] px-2 text-[10.5px] font-bold uppercase text-[#0E7490]">
                          {r.vehicle?.name ?? 'Car'} · {r.driver?.name?.split(' ')[0] ?? '—'}
                          {st === 'IN_TRIP' ? ' · on trip' : st === 'DONE' ? ' · done' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="w-[52px] flex-none text-[18px] font-bold">{time(r.scheduledAt)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{r.patientSnapshot?.name}</div>
                        <div className="text-[13px] leading-[18px] text-slate-500">
                          {team.length ? team.map((m: any) => shortName(m.name)).join(' + ') : 'Team not assigned yet'} · {team.length || '?'} staff · {driveMin(km)} min drive
                          {r.transport?.pickupAt ? ` · pick-up ${time(r.transport.pickupAt)}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      {!st || st === 'REQUESTED' ? (
                        <>
                          <OwnTransportButton id={id} requestNo={r.requestNo} />
                          <ALink href={`/m/trips/${id}/assign-car`} className="flex-[1.4]">
                            Assign car
                          </ALink>
                        </>
                      ) : st !== 'DONE' ? (
                        <ALink href={`/m/trips/${id}/assign-car${st === 'OWN' ? '?mode=own' : ''}`} kind="soft" className="flex-1">
                          Change
                        </ALink>
                      ) : null}
                    </div>
                  </div>
                )
              })}
          </div>
        ),
      )}
      {!rows.length && <Empty icon={<Truck size={26} />} title="No trip requests" sub="Confirmed visits that need a car for today and tomorrow appear here." />}
    </MScreen>
  )
}

// ------------------------------------------------------------------ D1 driver
const LEG_ACTION: Record<string, string> = { pickup: 'Team picked up', drive: 'Arrived at patient', wait: 'Team on board', return: 'Back at hospital' }
const LEG_TITLE: Record<string, string> = { pickup: 'Pick up team', drive: 'Drive to patient', wait: 'Wait during visit', return: 'Return to hospital' }

async function DriverTrips({ user, bell }: { user: SessionUser; bell: React.ReactNode }) {
  const { start, end } = dayRange()
  const [car, rows] = await Promise.all([
    Vehicle.findOne({ driverId: user.id }).lean<any>(),
    HomecareRequest.find({ deletedAt: null, 'transport.driverId': user.id, scheduledAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' } })
      .select('requestNo status scheduledAt expectedDurationMin patientId patientSnapshot services assignment transport')
      .lean<any[]>(),
  ])
  await withPeople(rows)
  rows.sort((a, b) => tripWindow(a)[0] - tripWindow(b)[0])
  const done = rows.filter((r) => r.transport?.status === 'DONE')
  const moving = (r: any) => r.transport?.status === 'IN_TRIP' || (r.transport?.status === 'ASSIGNED' && (r.transport?.legs ?? []).some((l: any) => l.at))
  const current = rows.find((r) => r.transport?.status === 'IN_TRIP') ?? rows.find((r) => r.transport?.status === 'ASSIGNED' && (r.transport?.legs ?? []).some((l: any) => l.at)) ?? rows.find((r) => r.transport?.status === 'ASSIGNED')
  const later = rows.filter((r) => r !== current && r.transport?.status !== 'DONE')
  const legs: any[] = current?.transport?.legs ?? []
  const legIdx = legs.findIndex((l) => !l.at)
  const leg = legIdx >= 0 ? legs[legIdx] : null
  const patient = current ? await Patient.findById(current.patientId).select('address phone').lean<any>() : null
  const team = current ? [current.primaryStaff, ...(current.secondaryStaff ?? [])].filter(Boolean) : []
  const navHref = leg && ['pickup', 'return'].includes(leg.key) ? mapsUrl('Unico Hospitals') : mapsUrl(current?.patientSnapshot?.address, patient?.address?.lat, patient?.address?.lng)
  return (
    <MScreen header={<SignedInHeader initials={user.initials} name={user.name} sub={`Driver${car ? ` · ${car.name} · ${car.plate}` : ' · no car assigned'}`} right={bell} />} tab="trips">
      <AutoRefresh seconds={30} />
      <div className="flex gap-2">
        <MiniKpi n={rows.length} label="Trips today" />
        <MiniKpi n={rows.filter(moving).length} label="Now" color="#0E7490" />
        <MiniKpi n={done.length} label="Done" color="#15803D" />
        {car?.fuelPct != null && <MiniKpi n={`${car.fuelPct}%`} label="Fuel" color={car.fuelPct < 25 ? '#B91C1C' : undefined} href="/m/vehicle" />}
      </div>

      {current && leg ? (
        <div className="rounded-2xl bg-slate-900 p-4 text-white">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-teal">
              Current trip · leg {legIdx + 1} of {legs.length}
            </div>
            <StatusChip status={moving(current) ? 'EN_ROUTE' : 'ASSIGNED'} label={moving(current) ? (leg.key === 'wait' ? 'At patient' : 'En route') : 'Scheduled'} sm />
          </div>
          <div className="mt-1.5 text-[24px] font-bold leading-[30px]">{LEG_TITLE[leg.key] ?? leg.label}</div>
          <div className="mt-0.5 text-[13px] text-white/75">
            {current.requestNo} · {current.patientSnapshot?.name} · {current.patientSnapshot?.address}
            {leg.plannedAt ? ` · ${leg.key === 'drive' ? 'ETA' : 'at'} ${time(leg.plannedAt)}` : ''}
          </div>
          {team.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[13px]">
              {team.map((m: any) => (
                <div key={m.id} className="flex size-[26px] flex-none items-center justify-center rounded-full bg-primary-50 text-[9px] font-bold text-primary-700">
                  {m.name.replace(/^(Dr\.?|Md\.?)\s+/i, '').split(' ').map((x: string) => x[0]).slice(0, 2).join('')}
                </div>
              ))}
              <span className="truncate text-white/80">
                {team.map((m: any) => shortName(m.name)).join(' · ')} {legIdx >= 1 && legIdx <= 2 ? 'on board' : ''}
              </span>
            </div>
          )}
          <div className="mt-3.5 flex gap-2">
            <a href={navHref} target="_blank" rel="noreferrer" className="flex size-[52px] flex-none items-center justify-center rounded-xl bg-white/15" aria-label="Navigate">
              <Navigation size={22} />
            </a>
            <a href={telUrl(team[0]?.phone ?? current.patientSnapshot?.phone)} className="flex size-[52px] flex-none items-center justify-center rounded-xl bg-white/15" aria-label="Call team">
              <Phone size={22} />
            </a>
            <LegButton id={String(current._id)} leg={leg.key} label={LEG_ACTION[leg.key] ?? 'Done'} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-900 p-4 text-white">
          <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-teal">No trip in progress</div>
          <div className="mt-1 text-[20px] font-bold">{rows.length ? 'All trips for today are done' : 'No trips assigned today'}</div>
          <div className="mt-0.5 text-[13px] text-white/75">The car supervisor assigns trips here. You get a notification for each one.</div>
        </div>
      )}

      {current && legs.length > 0 && (
        <>
          <SLabel>Trip legs</SLabel>
          <div className="overflow-hidden rounded-card bg-white shadow-card">
            {legs.map((l, i) => {
              const isDone = !!l.at
              const isCur = i === legIdx
              return (
                <div key={l.key} className={cx('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-slate-100')}>
                  {isDone ? (
                    <div className="flex size-[22px] flex-none items-center justify-center rounded-full bg-[#16A34A] text-white">
                      <Check size={14} strokeWidth={3} />
                    </div>
                  ) : (
                    <div className={cx('size-[22px] flex-none rounded-full', isCur ? 'border-[3px] border-[#0891B2]' : 'border-2 border-slate-300')} />
                  )}
                  <div className="flex-1">
                    <div className={cx('text-[14px]', isCur ? 'font-bold text-slate-900' : isDone ? 'font-semibold text-slate-900' : 'font-semibold text-slate-400')}>{l.label}</div>
                    <div className="text-[12px] text-slate-500">
                      {isDone ? `${l.plannedAt ? `${time(l.plannedAt)} · ` : ''}stamped ${time(l.at)}` : l.key === 'wait' ? `~${current.expectedDurationMin ?? 45} min · ${time(current.scheduledAt)}–${time(new Date(new Date(current.scheduledAt).getTime() + (current.expectedDurationMin ?? 45) * 60000))}` : l.plannedAt ? `${isCur && l.key === 'drive' ? 'ETA ' : '~'}${time(l.plannedAt)}` : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {later.length > 0 && (
        <>
          <SLabel>Later today</SLabel>
          {later.map((r) => (
            <div key={String(r._id)} className="flex items-center gap-3 rounded-card bg-white px-3.5 py-3 shadow-card">
              <div className="w-12 flex-none text-[15px] font-bold text-slate-500">{time(r.transport?.pickupAt ?? r.scheduledAt)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">
                  {r.patientSnapshot?.name} · {r.patientSnapshot?.area}
                </div>
                <div className="truncate text-[12px] text-slate-500">
                  {r.requestNo} · {[r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean).map((m: any) => shortName(m.name)).join(' + ') || 'team pending'}
                </div>
              </div>
              <a href={mapsUrl(r.patientSnapshot?.address)} target="_blank" rel="noreferrer" className="flex size-9 items-center justify-center text-slate-400" aria-label="Map">
                <ChevronRight size={18} />
              </a>
            </div>
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <SLabel>Done today</SLabel>
          <MList>
            {done.map((r) => (
              <MRow key={String(r._id)}>
                <div className="flex size-[22px] flex-none items-center justify-center rounded-full bg-[#16A34A] text-white">
                  <Check size={14} strokeWidth={3} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {r.patientSnapshot?.name} · {r.patientSnapshot?.area}
                  </div>
                  <div className="text-[12px] text-slate-500">
                    {r.requestNo} · back {time(r.transport?.legs?.find((l: any) => l.key === 'return')?.at)}
                  </div>
                </div>
              </MRow>
            ))}
          </MList>
        </>
      )}
      <div className="text-center text-[12px] text-slate-400">{relDay(new Date())} · times are planned; each tap stamps the real time</div>
    </MScreen>
  )
}
