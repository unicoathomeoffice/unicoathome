import 'server-only'
import { z } from 'zod'
import type { Model } from 'mongoose'
import { Department, Designation, Zone, ServiceType, Vehicle, User, HomecareRequest } from './models'
import type { Permission } from './constants'

type Master = { model: Model<any>; entity: string; perm: Permission; sort: Record<string, 1 | -1>; schema: z.ZodObject<any>; usage?: (ids: unknown[]) => Promise<Record<string, number>> }

async function countBy(model: Model<any>, field: string, ids: unknown[]) {
  const rows = await model.aggregate([{ $match: { [field]: { $in: ids }, deletedAt: null } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }])
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]))
}

const checklistItem = z.object({ key: z.string().min(1), label: z.string().min(1), mandatory: z.boolean().default(true), sortOrder: z.number().optional() })

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
      checklist: z.array(checklistItem).default([]),
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
}
