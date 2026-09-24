import { z } from 'zod'
import { route, body, clientMeta, notFound, bad } from '@/lib/api'
import { Vehicle, User } from '@/lib/models'
import { audit, diff } from '@/lib/audit'
import { plain } from '@/lib/db'

async function myVehicle(userId: string) {
  const v = await Vehicle.findOne({ driverId: userId, isActive: { $ne: false } })
  if (v) return v
  const u = await User.findById(userId).select('vehicleId').lean<any>()
  return u?.vehicleId ? Vehicle.findById(u.vehicleId) : null
}

/** GET /api/v1/vehicles/mine — the signed-in driver's car */
export const GET = route(
  async ({ user }) => {
    const v = await myVehicle(user.id)
    if (!v) throw notFound('Vehicle')
    return { vehicle: plain(v.toObject()) }
  },
  { roles: ['DRIVER'] },
)

const Patch = z.object({
  odometerKm: z.coerce.number().int().min(0).max(2_000_000).optional(),
  fuelPct: z.coerce.number().min(0).max(100).optional(),
  statusNote: z.string().max(200).optional(),
})

/** PATCH /api/v1/vehicles/mine {odometerKm?, fuelPct?, statusNote?} — the linked driver only */
export const PATCH = route(
  async ({ req, user }) => {
    const v = await myVehicle(user.id)
    if (!v) throw notFound('Vehicle')
    const input = await body(req, Patch)
    if (input.odometerKm != null && v.odometerKm != null && input.odometerKm < v.odometerKm) {
      throw bad(`Odometer can't go down (last reading ${v.odometerKm.toLocaleString('en-IN')} km)`, { odometerKm: 'Too low' })
    }
    const before = { odometerKm: v.odometerKm, fuelPct: v.fuelPct, statusNote: v.statusNote }
    for (const k of ['odometerKm', 'fuelPct', 'statusNote'] as const) if (input[k] != null) v.set(k, input[k])
    await v.save()
    await audit(user, 'vehicle.driver_update', 'vehicle', v._id, { ...diff(before, { odometerKm: v.odometerKm, fuelPct: v.fuelPct, statusNote: v.statusNote }), label: `${v.name} · ${v.plate}` }, clientMeta(req, user))
    return { ok: true }
  },
  { roles: ['DRIVER'] },
)
