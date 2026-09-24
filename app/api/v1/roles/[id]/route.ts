import { z } from 'zod'
import { route, body, clientMeta, notFound, bad } from '@/lib/api'
import { CustomRole, User, isOid } from '@/lib/models'
import { PERMISSIONS } from '@/lib/constants'
import { audit, diff } from '@/lib/audit'

const PERM_KEYS = Object.keys(PERMISSIONS) as [string, ...string[]]
const Patch = z.object({
  name: z.string().min(2).max(80).optional(),
  permissions: z.array(z.enum(PERM_KEYS)).optional(),
  description: z.string().max(500).optional(),
})

export const PATCH = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw notFound('Role')
    const doc = await CustomRole.findById(params.id)
    if (!doc) throw notFound('Role')
    const input = await body(req, Patch)
    const pick = (o: any) => ({ name: o.name, permissions: [...(o.permissions ?? [])], description: o.description })
    const before = pick(doc.toObject())
    doc.set(input)
    await doc.save()
    await audit(user, 'role.update', 'role', doc._id, { ...diff(before, pick(doc.toObject())), label: doc.name }, clientMeta(req, user))
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN'] },
)

export const DELETE = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw notFound('Role')
    const holders = await User.countDocuments({ customRoleId: params.id, deletedAt: null })
    if (holders) throw bad(`${holders} user${holders === 1 ? ' has' : 's have'} this role. Remove it from them in Staff first.`)
    const doc = await CustomRole.findByIdAndDelete(params.id)
    if (!doc) throw notFound('Role')
    await audit(user, 'role.delete', 'role', params.id, { before: doc.toObject(), label: doc.name }, clientMeta(req, user))
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN'] },
)
