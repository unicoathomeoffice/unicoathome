import 'server-only'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { HomecareRequest, LocationPing, Patient, User } from '../models'
import { getSettings } from '../settings'
import { conflict, forbidden } from '../api'
import { isTeamMember } from './requests'
import type { SessionUser } from '../auth'

// Live location of the care team: phase OUT from "Start journey" until check-in, phase RETURN from check-out until
// they are back at the hospital (geofence around Settings → General → hospital location, or the button).
// The field app posts a point every ~15 s while the screen is open (components/field/useLiveTracking.ts).

export type Phase = 'OUT' | 'RETURN'
const R = 6371e3
/** metres between two points */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const t = (d: number) => (d * Math.PI) / 180
  const x = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
const ROAD_FACTOR = 1.35 // Dhaka roads vs a straight line
const CITY_KMH = 18 // fallback speed when the device has no recent speed

/** Called from enRoute(): starts phase OUT (new share token for the patient link). Doesn't save. */
export function startOut(r: any, userId: string) {
  r.set('tracking', { active: true, phase: 'OUT', userId, startedAt: new Date(), shareToken: randomBytes(12).toString('base64url') })
  return r.get('tracking.shareToken') as string
}

/** Called from checkIn() / cancel(): the trip is over. Doesn't save. */
export function stopTracking(r: any) {
  if (r.tracking?.active) r.set('tracking.active', false)
}

/** Called from checkOut(): start the way back when live tracking is on and the hospital pin is set. Doesn't save. */
export async function startReturn(r: any, userId: string) {
  const s = await getSettings()
  const h = s.general.hospitalLocation
  if (!s.features.liveTracking || h?.lat == null || h?.lng == null) return false
  const now = new Date()
  r.set('tracking.active', true)
  r.set('tracking.phase', 'RETURN')
  r.set('tracking.userId', userId)
  r.set('tracking.startedAt', now)
  r.set('tracking.lostNotifiedAt', undefined)
  r.set('returnTrip', { startedAt: now })
  return true
}

/** A user starting a new journey closes their unfinished way back from an earlier visit. */
export async function closeOpenReturns(userId: string, exceptId: unknown) {
  const open = await HomecareRequest.find({ _id: { $ne: exceptId }, 'tracking.active': true, 'tracking.phase': 'RETURN', 'tracking.userId': userId }).select('_id').lean<any[]>()
  for (const o of open) await finishReturn(o._id, 'next_visit')
}

/** End the way back; records arrival time, duration and travelled distance. Returns true if it was open. */
export async function finishReturn(requestId: unknown, by: 'geofence' | 'button' | 'next_visit' | 'timeout', at = new Date()) {
  const r = await HomecareRequest.findOne({ _id: requestId, 'tracking.active': true, 'tracking.phase': 'RETURN' }).select('returnTrip tracking').lean<any>()
  if (!r) return false
  const started = r.returnTrip?.startedAt ? new Date(r.returnTrip.startedAt) : r.tracking?.startedAt ? new Date(r.tracking.startedAt) : at
  const pts = await LocationPing.find({ requestId, phase: 'RETURN', at: { $gte: started } }).sort({ at: 1 }).select('lat lng').lean<any[]>()
  let m = 0
  for (let i = 1; i < pts.length; i++) m += haversine(pts[i - 1], pts[i])
  const reached = by === 'next_visit' || by === 'timeout' ? undefined : at
  await HomecareRequest.updateOne(
    { _id: requestId },
    {
      $set: {
        'tracking.active': false,
        'returnTrip.reachedBy': by,
        ...(reached ? { 'returnTrip.reachedAt': reached, 'returnTrip.durationMin': Math.max(0, Math.round((reached.getTime() - started.getTime()) / 60000)) } : {}),
        'returnTrip.distanceKm': Math.round(m / 100) / 10,
      },
    },
  )
  if (reached) {
    const { sendVisitUpdate } = await import('./updates')
    await sendVisitUpdate(requestId, 'auto').catch((e) => console.error('[visit update]', e))
    const { carAlertLazy, visitAlertLazy } = await import('./requests')
    await carAlertLazy('CAR_BACK', requestId, { at: reached })
    await visitAlertLazy('BACK_AT_HOSPITAL', requestId, { at: reached })
  }
  return true
}

export const PingInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().optional(),
  heading: z.number().optional().nullable(),
  speed: z.number().optional().nullable(),
  deviceAt: z.string().optional(),
})

/** One point from the field app. Ignored (not an error) when the trip has ended — the phone may lag a little. */
export async function recordPing(r: any, input: z.infer<typeof PingInput>, user: SessionUser) {
  if (!isTeamMember(user, r)) throw forbidden('Only the assigned care team shares location for this visit')
  const t = r.tracking
  if (!t?.active) return { active: false as const }
  if (input.accuracyM != null && input.accuracyM > 500) return { active: true as const, phase: t.phase as Phase, dropped: true }
  const at = new Date()
  const point = { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM, heading: input.heading ?? undefined, speed: input.speed ?? undefined }
  await Promise.all([
    LocationPing.create({ requestId: r._id, userId: user.id, phase: t.phase, ...point, at }),
    HomecareRequest.updateOne({ _id: r._id }, { $set: { 'tracking.lat': point.lat, 'tracking.lng': point.lng, 'tracking.accuracyM': point.accuracyM, 'tracking.heading': point.heading, 'tracking.speed': point.speed, 'tracking.at': at, 'tracking.userId': user.id, 'tracking.lostNotifiedAt': null } }),
  ])
  if (t.phase === 'RETURN') {
    const s = await getSettings()
    const h = s.general.hospitalLocation
    if (h?.lat != null && h?.lng != null && haversine(point, { lat: h.lat, lng: h.lng }) <= (h.radiusM || 150)) {
      await finishReturn(r._id, 'geofence', at)
      return { active: false as const, reached: true }
    }
  }
  return { active: true as const, phase: t.phase as Phase }
}

/** Where the team is heading in the current phase: the patient's door (OUT) or the hospital (RETURN). */
async function target(r: any): Promise<{ lat: number; lng: number; label: string } | null> {
  if (r.tracking?.phase === 'RETURN') {
    const h = (await getSettings()).general.hospitalLocation
    return h?.lat != null && h?.lng != null ? { lat: h.lat, lng: h.lng, label: 'Hospital' } : null
  }
  const p = await Patient.findById(r.patientId).select('address.lat address.lng').lean<any>()
  return p?.address?.lat != null && p?.address?.lng != null ? { lat: p.address.lat, lng: p.address.lng, label: 'Patient' } : null
}

/** Live view: last point, trail of the current (or last) phase, destination and ETA. */
export async function liveView(r: any, opts: { trail?: boolean; since?: Date } = {}) {
  const t = r.tracking ?? {}
  const dest = await target(r)
  const phase: Phase | undefined = t.phase
  const from = t.startedAt ? new Date(t.startedAt) : undefined
  const trail =
    opts.trail === false || !phase
      ? []
      : await LocationPing.find({ requestId: r._id, phase, ...(from || opts.since ? { at: { $gte: opts.since && from ? new Date(Math.max(+opts.since, +from)) : (opts.since ?? from) } } : {}) })
          .sort({ at: 1 })
          .limit(2000)
          .select('lat lng at -_id')
          .lean<any[]>()
  let eta: { km: number; min: number } | null = null
  if (t.active && t.lat != null && dest) {
    const km = (haversine({ lat: t.lat, lng: t.lng }, dest) * ROAD_FACTOR) / 1000
    const recent = await LocationPing.find({ requestId: r._id, at: { $gte: new Date(Date.now() - 5 * 60_000) }, speed: { $gt: 0.5 } }).select('speed').lean<any[]>()
    const ms = recent.length ? recent.reduce((a, p) => a + p.speed, 0) / recent.length : 0
    const kmh = ms ? Math.min(45, Math.max(8, ms * 3.6)) : CITY_KMH
    eta = { km: Math.round(km * 10) / 10, min: Math.max(1, Math.round((km / kmh) * 60)) }
  }
  return {
    active: !!t.active,
    phase: phase ?? null,
    at: t.at ? new Date(t.at).toISOString() : null,
    point: t.lat != null ? { lat: t.lat, lng: t.lng, accuracyM: t.accuracyM ?? null, heading: t.heading ?? null } : null,
    dest,
    eta,
    trail: trail.map((p) => [p.lat, p.lng, new Date(p.at).getTime()] as [number, number, number]),
    returnTrip: r.returnTrip ?? null,
  }
}

export function assertTrackingOn(on: boolean) {
  if (!on) throw conflict('TRACKING_OFF', 'Live tracking is switched off in Settings')
}

/** /live map: every active trip with staff, patient, destination, ETA and how fresh the last point is. */
export async function liveBoard() {
  const rows = await HomecareRequest.find({ 'tracking.active': true, deletedAt: null }).select('requestNo status patientId patientSnapshot services tracking returnTrip').lean<any[]>()
  const users = await User.find({ _id: { $in: rows.map((r) => r.tracking?.userId).filter(Boolean) } }).select('name').lean<any[]>()
  return Promise.all(
    rows.map(async (r) => {
      const v = await liveView(r, { trail: false })
      const u = users.find((x) => String(x._id) === String(r.tracking?.userId))
      return {
        id: String(r._id),
        requestNo: r.requestNo,
        patient: r.patientSnapshot?.name ?? '',
        area: r.patientSnapshot?.area ?? '',
        service: (r.services ?? []).map((s: any) => s.name).join(', '),
        staff: u?.name ?? '',
        phase: v.phase,
        at: v.at,
        point: v.point,
        dest: v.dest,
        eta: v.eta,
      }
    }),
  )
}
