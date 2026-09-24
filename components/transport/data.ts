import 'server-only'
import { redirect } from 'next/navigation'
import { requireAppUser, type SessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { HomecareRequest, User, Vehicle } from '@/lib/models'
import { can } from '@/lib/constants'
import { dayRange, isoDay, time } from '@/lib/format'

/** Trips / fleet screens: car supervisor, drivers and coordinators (transport.manage). */
export async function requireTransport(driverOk = true): Promise<SessionUser> {
  const u = await requireAppUser()
  if (!(can(u, 'transport.manage') || (driverOk && u.role === 'DRIVER'))) redirect('/m?denied=1')
  await db()
  return u
}

const ACTIVE_TRIP = ['ASSIGNED', 'IN_TRIP']

/** Window a trip occupies the car: pick-up → return (falls back to visit time ± buffers). */
export function tripWindow(r: any): [number, number] {
  const at = r.scheduledAt ? new Date(r.scheduledAt).getTime() : Date.now()
  const s = r.transport?.pickupAt ? new Date(r.transport.pickupAt).getTime() : at - 40 * 60_000
  const e = r.transport?.returnAt ? new Date(r.transport.returnAt).getTime() : at + ((r.expectedDurationMin ?? 45) + 60) * 60_000
  return [s, e]
}

/** Every active car with its driver and today's trips; `now` state for the fleet strip. */
export async function fleet(day = isoDay()) {
  const { start, end } = dayRange(day)
  const vehicles = await Vehicle.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean<any[]>()
  const [drivers, trips] = await Promise.all([
    User.find({ _id: { $in: vehicles.map((v) => v.driverId).filter(Boolean) } }).select('name phone availability').lean<any[]>(),
    HomecareRequest.find({ deletedAt: null, 'transport.vehicleId': { $in: vehicles.map((v) => v._id) }, scheduledAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' } })
      .select('requestNo scheduledAt expectedDurationMin transport patientSnapshot status')
      .lean<any[]>(),
  ])
  const now = Date.now()
  return vehicles.map((v) => {
    const mine = trips.filter((t) => String(t.transport?.vehicleId) === String(v._id)).sort((a, b) => tripWindow(a)[0] - tripWindow(b)[0])
    const current = mine.find((t) => t.transport?.status === 'IN_TRIP') ?? mine.find((t) => ACTIVE_TRIP.includes(t.transport?.status) && tripWindow(t)[0] <= now && tripWindow(t)[1] >= now)
    const next = mine.find((t) => t.transport?.status === 'ASSIGNED' && tripWindow(t)[0] > now)
    const driver = drivers.find((d) => String(d._id) === String(v.driverId)) ?? null
    const state: 'FREE' | 'ON_TRIP' | 'IN_SERVICE' = v.status === 'IN_SERVICE' ? 'IN_SERVICE' : current || v.status === 'ON_TRIP' ? 'ON_TRIP' : 'FREE'
    const serviceLeft = v.nextServiceKm != null && v.odometerKm != null ? v.nextServiceKm - v.odometerKm : null
    return {
      id: String(v._id),
      name: v.name as string,
      plate: v.plate as string,
      model: v.model as string | undefined,
      seats: v.seats as number | undefined,
      status: v.status as string,
      statusNote: v.statusNote as string | undefined,
      state,
      odometerKm: v.odometerKm as number | undefined,
      fuelPct: v.fuelPct as number | undefined,
      nextServiceKm: v.nextServiceKm as number | undefined,
      serviceLeft,
      serviceDue: v.status === 'IN_SERVICE' || (serviceLeft != null && serviceLeft < 1000),
      driver: driver ? { id: String(driver._id), name: driver.name as string, phone: driver.phone as string } : null,
      current: current ? { id: String(current._id), requestNo: current.requestNo, area: current.patientSnapshot?.area, back: current.transport?.returnAt ?? null } : null,
      next: next ? { id: String(next._id), requestNo: next.requestNo, pickupAt: next.transport?.pickupAt ?? null } : null,
      trips: mine.map((t) => ({ id: String(t._id), requestNo: t.requestNo, window: tripWindow(t), status: t.transport?.status, area: t.patientSnapshot?.area })),
    }
  })
}
export type FleetCar = Awaited<ReturnType<typeof fleet>>[number]

/** Short "now" label for a car: Free · On trip · Uttara · Service */
export function carNow(c: FleetCar) {
  if (c.state === 'IN_SERVICE') return 'Service'
  if (c.state === 'ON_TRIP') return `On trip${c.current?.area ? ` · ${c.current.area}` : ''}`
  return 'Free'
}

/** Availability of a car for a requested window (S4b rows). */
export function availability(c: FleetCar, win: [number, number], exceptRequestId?: string) {
  if (c.state === 'IN_SERVICE') return { ok: false, label: `In service${c.statusNote ? ` · ${c.statusNote}` : ''}` }
  const clash = c.trips.find((t) => t.id !== exceptRequestId && t.status !== 'DONE' && t.window[0] < win[1] && t.window[1] > win[0])
  if (clash) return { ok: false, label: `On trip ${clash.area ?? ''} · back ~${time(clash.window[1])}`.replace('  ', ' ') }
  const before = c.trips.filter((t) => t.id !== exceptRequestId && t.status !== 'DONE' && t.window[1] <= win[0]).pop()
  return { ok: true, label: before ? `Free from ${time(before.window[1])}` : c.state === 'ON_TRIP' ? `On trip now · back ~${time(c.current?.back)}` : 'Free' }
}
