import { z } from 'zod'
import { route, body, clientMeta, notFound, bad } from '@/lib/api'
import { Vehicle, User, isOid } from '@/lib/models'
import { audit } from '@/lib/audit'

/**
 * POST /api/v1/vehicles/:id/driver {driverId: string | null} — give a car to a driver (or take the driver off).
 * Keeps one car per driver: the driver is removed from any other car, and User.vehicleId follows.
 */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw notFound('Vehicle')
    const { driverId } = await body(req, z.object({ driverId: z.string().nullable() }))
    const v = await Vehicle.findById(params.id)
    if (!v) throw notFound('Vehicle')
    const prev = v.driverId ? String(v.driverId) : null
    let driverName: string | null = null
    if (driverId) {
      if (!isOid(driverId)) throw bad('Invalid driver')
      const d = await User.findOne({ _id: driverId, role: 'DRIVER', deletedAt: null }).select('name').lean<any>()
      if (!d) throw bad('Pick an active driver')
      driverName = d.name
      await Vehicle.updateMany({ _id: { $ne: v._id }, driverId }, { $unset: { driverId: 1 } })
      await User.updateOne({ _id: driverId }, { vehicleId: v._id })
      v.driverId = driverId
    } else {
      v.set('driverId', undefined)
    }
    if (prev && prev !== driverId) await User.updateOne({ _id: prev, vehicleId: v._id }, { $unset: { vehicleId: 1 } })
    await v.save()
    await audit(user, 'vehicle.assign_driver', 'vehicle', v._id, { before: { driverId: prev }, after: { driverId, driver: driverName }, label: `${v.name} · ${v.plate}` }, clientMeta(req, user))
    return { ok: true }
  },
  { perm: 'transport.manage' },
)
