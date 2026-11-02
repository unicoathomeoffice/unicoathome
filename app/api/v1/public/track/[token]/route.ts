import { publicRoute, notFound } from '@/lib/api'
import { Designation, HomecareRequest, User } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { liveView } from '@/lib/services/tracking'

/** GET /api/v1/public/track/:token — the patient's live tracking link (no sign-in; the token is the secret). */
export const GET = publicRoute<{ token: string }>(async ({ params }) => {
  if (!/^[\w-]{12,40}$/.test(params.token)) throw notFound('Link')
  const r = await HomecareRequest.findOne({ 'tracking.shareToken': params.token, deletedAt: null }).select('status tracking patientId timeline assignment requestNo').lean<any>()
  if (!r) throw notFound('Link')
  const staff = r.tracking?.userId ? await User.findById(r.tracking.userId).select('name designationId').lean<any>() : null
  const desig = staff?.designationId ? await Designation.findById(staff.designationId).select('title').lean<any>() : null
  // only the way to the patient is shared — never the way back
  const out = r.tracking?.phase === 'OUT' && r.tracking.active ? await liveView(r, { trail: false }) : null
  return {
    requestNo: r.requestNo,
    state: out ? 'on_the_way' : r.timeline?.checkInAt ? 'arrived' : r.status === 'CANCELLED' ? 'cancelled' : 'ended',
    // first name + designation only; calls go to the hospital line, never the staff member's own number
    staff: staff ? { firstName: String(staff.name ?? '').replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(' ')[0], designation: desig?.title ?? '' } : null,
    hotline: (await getSettings()).general.hospitalPhone,
    at: out?.at ?? null,
    point: out?.point ? { lat: out.point.lat, lng: out.point.lng } : null,
    dest: out?.dest ? { lat: out.dest.lat, lng: out.dest.lng } : null,
    eta: out?.eta ?? null,
  }
})
