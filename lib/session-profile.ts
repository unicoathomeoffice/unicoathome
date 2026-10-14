import 'server-only'
import { Types } from 'mongoose'
import { User, Designation, CustomRole } from './models'

/** Read current account permissions in one database round trip. Never cached across requests. */
export async function sessionProfile(userId: string) {
  if (!Types.ObjectId.isValid(userId)) return null
  const [user] = await User.aggregate([
    { $match: { _id: new Types.ObjectId(userId) } },
    { $project: {
      employeeId: 1, name: 1, role: 1, roles: 1, status: 1, deletedAt: 1,
      phone: 1, email: 1, platformAccess: 1, availability: 1,
      zones: 1, skills: 1, photoUrl: 1, designationId: 1, customRoleId: 1,
    } },
    { $lookup: {
      from: Designation.collection.name, localField: 'designationId', foreignField: '_id',
      pipeline: [{ $project: { title: 1 } }], as: 'designationRecords',
    } },
    { $lookup: {
      from: CustomRole.collection.name, localField: 'customRoleId', foreignField: '_id',
      pipeline: [{ $project: { name: 1, permissions: 1 } }], as: 'customRoleRecords',
    } },
  ])
  return user ?? null
}
