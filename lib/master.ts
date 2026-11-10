import 'server-only'
import { z } from 'zod'
import type { Model } from 'mongoose'
import { Department, Designation, Zone, ServiceType, Vehicle, User, HomecareRequest, Equipment, isOid, oid } from './models'
import type { Permission } from './constants'

type Master = { model: Model<any>; entity: string; perm: Permission; sort: Record<string, 1 | -1>; schema: z.ZodObject<any>; usage?: (ids: unknown[]) => Promise<Record<string, number>> }

async function countBy(model: Model<any>, field: string, ids: unknown[]) {
  // aggregate() does not cast: string ids (e.g. from a DELETE route param) must become ObjectIds,
  // and array fields (services.serviceTypeId) are unwound so multi-service requests count per id.
  const oids = ids.map((i) => (typeof i === 'string' && isOid(i) ? oid(i) : i))
  const rows = await model.aggregate([
    { $match: { [field]: { $in: oids }, deletedAt: null } },
    { $project: { v: `$${field}` } },
    { $unwind: '$v' },
    { $match: { v: { $in: oids } } },
    { $group: { _id: '$v', n: { $sum: 1 } } },
  ])
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]))
}

const checklistItem = z.object({ key: z.string().min(1), label: z.string().min(1), mandatory: z.boolean().default(true), sortOrder: z.number().optional() })
const afterItem = checklistItem.extend({ withNote: z.boolean().optional(), notePrompt: z.string().max(60).optional() })

/** Generic master-data lists served by /api/v1/master/:kind */
export const MASTER: Record<string, Master> = {
  departments: {
    model: Department,
    entity: 'department',
    perm: 'master.manage',
    sort: { sortOrder: 1, name: 1 },
    schema: z.object({ name: z.string().min(2), code: z.string().optional(), isActive: z.boolean().default(true), sortOrder: z.number().default(0) }),
    usage: (ids) => countBy(User, 'departmentId', ids),
  },
  designations: {
    model: Designation,
    entity: 'designation',
    perm: 'master.manage',
    sort: { sortOrder: 1, title: 1 },
    schema: z.object({ title: z.string().min(2), departmentId: z.string().optional(), grade: z.string().optional(), isActive: z.boolean().default(true), sortOrder: z.number().default(0) }),
    usage: (ids) => countBy(User, 'designationId', ids),
  },
  zones: {
    model: Zone,
    entity: 'zone',
    perm: 'master.manage',
    sort: { sortOrder: 1, name: 1 },
    schema: z.object({ name: z.string().min(2), travelBufferMin: z.coerce.number().int().min(0).default(45), isActive: z.boolean().default(true), sortOrder: z.number().default(0) }),
  },
  'service-types': {
    model: ServiceType,
    entity: 'service_type',
    perm: 'master.manage',
    sort: { sortOrder: 1, name: 1 },
    schema: z.object({
      code: z.string().min(2).regex(/^[A-Z0-9_]+$/, 'Use CAPITALS, digits and _'),
      name: z.string().min(2),
      category: z.string().optional(),
      requiredSkills: z.array(z.string()).default([]),
      defaultDurationMin: z.coerce.number().int().positive().default(45),
      fee: z.coerce.number().nonnegative().default(0),
      requiresPrescription: z.boolean().default(false),
      checklist: z.array(checklistItem).default([]),
      afterChecklist: z.array(afterItem).optional(), // after return to the hospital; unset = built-in defaults
      kit: z.array(z.object({ itemId: z.string().refine(isOid, 'Pick an item'), recommendedQty: z.coerce.number().int().min(0).max(99).default(1), minQty: z.coerce.number().int().min(0).max(99).default(0), usualUse: z.coerce.number().min(0).max(999).optional() })).default([]),
      vitalsRequired: z.array(z.string()).default([]),
      staffMix: z.array(z.object({ role: z.string(), count: z.coerce.number().int().min(1) })).default([]),
      isActive: z.boolean().default(true),
      sortOrder: z.number().default(0),
    }),
    usage: (ids) => countBy(HomecareRequest, 'services.serviceTypeId', ids),
  },
  vehicles: {
    model: Vehicle,
    entity: 'vehicle',
    perm: 'transport.manage',
    sort: { name: 1 },
    schema: z.object({
      name: z.string().min(1),
      plate: z.string().min(3),
      model: z.string().optional(),
      seats: z.coerce.number().int().positive().optional(),
      status: z.enum(['FREE', 'ON_TRIP', 'IN_SERVICE']).default('FREE'),
      statusNote: z.string().optional(),
      driverId: z.string().optional(),
      supervisorId: z.string().optional(),
      odometerKm: z.coerce.number().optional(),
      fuelPct: z.coerce.number().min(0).max(100).optional(),
      nextServiceKm: z.coerce.number().optional(),
      serviceNote: z.string().optional(),
      isActive: z.boolean().default(true),
    }),
    usage: (ids) => countBy(HomecareRequest, 'transport.vehicleId', ids),
  },
  // instruments + consumables (Settings → Equipment & consumables); in use = on a service's bag or any visit
  equipment: {
    model: Equipment,
    entity: 'equipment',
    perm: 'master.manage',
    sort: { sortOrder: 1, name: 1 },
    schema: z.object({
      name: z.string().trim().min(2),
      type: z.enum(['EQUIPMENT', 'CONSUMABLE']).default('CONSUMABLE'),
      unit: z.string().trim().min(1).max(20).default('pcs'),
      notes: z.string().max(300).optional(),
      isActive: z.boolean().default(true),
      sortOrder: z.number().default(0),
    }),
    usage: async (ids) => {
      const [a, b, c] = await Promise.all([countBy(ServiceType, 'kit.itemId', ids), countBy(HomecareRequest, 'visit.kit.itemId', ids), countBy(HomecareRequest, 'visit.consumables.itemId', ids)])
      const out: Record<string, number> = {}
      for (const m of [a, b, c]) for (const [k, n] of Object.entries(m)) out[k] = (out[k] ?? 0) + n
      return out
    },
  },
}
