import { publicRoute, notFound } from '@/lib/api'
import { Designation, HomecareRequest, User, Vehicle } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { liveView } from '@/lib/services/tracking'

const first = (n?: string | null) => String(n ?? '').replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(' ')[0]

/** GET /api/v1/public/track/:token — the patient's live tracking link (no sign-in; the token is the secret).
 *  Uber-style card: who is coming (first name, designation, photo), the car when a hospital car is used, the road
 *  ahead and the ETA. Calls go to the hospital line, never a staff member's own number. */
export const GET = publicRoute<{ token: string }>(async ({ params }) => {
  if (!/^[\w-]{12,40}$/.test(params.token)) throw notFound('Link')
  const r = await HomecareRequest.findOne({ 'tracking.shareToken': params.token, deletedAt: null }).select('status tracking patientId timeline assignment requestNo transport services patientSnapshot.name').lean<any>()
  if (!r) throw notFound('Link')
  const staff = r.tracking?.userId ? await User.findById(r.tracking.userId).select('name designationId photoUrl').lean<any>() : null
  const desig = staff?.designationId ? await Designation.findById(staff.designationId).select('title').lean<any>() : null
  // only the way to the patient is shared — never the way back
  const out = r.tracking?.phase === 'OUT' && r.tracking.active ? await liveView(r, { trail: false }) : null
  const car = r.transport?.mode === 'UNICO_CAR' && r.transport?.vehicleId ? await Vehicle.findById(r.transport.vehicleId).select('name plate model').lean<any>() : null
  const driver = car && r.transport?.driverId ? await User.findById(r.transport.driverId).select('name').lean<any>() : null
  const team = (r.assignment?.secondaryStaffIds ?? []).length
  const s = await getSettings()
  const tl = r.timeline ?? {}
  return {
    state: out ? 'on_the_way' : r.status === 'CANCELLED' ? 'cancelled' : tl.checkOutAt ? 'done' : tl.checkInAt ? 'arrived' : 'ended',
    staff: staff ? { firstName: first(staff.name), designation: desig?.title ?? '', photo: out && staff.photoUrl ? `/api/v1/public/track/${params.token}/photo` : null, others: team } : null,
    car: car ? { name: car.name ?? car.model ?? 'Unico car', plate: car.plate ?? '', driver: first(driver?.name) || null } : null,
    service: (r.services ?? []).map((x: any) => x.name).join(', '),
    hotline: s.general.hospitalPhone,
    hospital: s.general.hospitalName,
    steps: { startedAt: tl.enRouteAt ?? null, arrivedAt: tl.checkInAt ?? null, doneAt: tl.checkOutAt ?? null },
    at: out?.at ?? null,
    pausedAt: out?.pausedAt ?? null,
    point: out?.point ? { lat: out.point.lat, lng: out.point.lng, heading: out.point.heading ?? null } : null,
    dest: out?.dest ? { lat: out.dest.lat, lng: out.dest.lng } : null,
    eta: out?.eta ?? null,
    route: out?.route ?? null,
    speedKmh: out?.speedKmh ?? null,
  }
})
