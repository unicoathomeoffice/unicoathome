import 'server-only'
import { ServiceType, Zone } from './models'
import { forget, memo } from './memo'

// Slow-changing master lists shared by many pages, read at most every 30 s per instance.
// Master-list writes (/api/v1/master/:kind) call forgetMaster() so this instance sees an edit at once.
const TTL = 30_000

/** Active service types, in display order, with the fields pages need for pickers and fees. */
export const activeServices = () =>
  memo('master:services', TTL, () =>
    ServiceType.find({ isActive: { $ne: false } })
      .sort({ sortOrder: 1, name: 1 })
      .select('code name category fee defaultDurationMin requiresPrescription')
      .lean<{ _id: unknown; code: string; name: string; category?: string; fee?: number; defaultDurationMin?: number; requiresPrescription?: boolean }[]>(),
  )

/** Active zone names, in display order. */
export const activeZones = () => memo('master:zones', TTL, async () => (await Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<{ name: string }[]>()).map((z) => z.name))

export const forgetMaster = () => {
  forget('master:')
  forget('home:') // the landing page memoises its own copies
}
