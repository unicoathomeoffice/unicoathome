import { z } from 'zod'
import { route, body, clientMeta, bad } from '@/lib/api'
import { CustomRole } from '@/lib/models'
import { PERMISSIONS, ROLES } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'

const PERM_KEYS = Object.keys(PERMISSIONS) as [string, ...string[]]

const RoleInput = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, 'Use CAPITALS, digits and _'),
  name: z.string().min(2).max(80),
  baseRole: z.enum(ROLES),
  permissions: z.array(z.enum(PERM_KEYS)).default([]),
  description: z.string().max(500).optional(),
})

/** GET /api/v1/roles — custom roles (templates copied from a fixed role). SUPER_ADMIN only. */
export const GET = route(
  async () => {
    const items = await CustomRole.find({}).sort({ createdAt: 1 }).lean<any[]>()
    return { items: plain(items) }
  },
  { roles: ['SUPER_ADMIN'] },
)

export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, RoleInput)
    if ((ROLES as readonly string[]).includes(input.code)) throw bad('That code belongs to a fixed role', { code: 'Choose a different code' })
    if (await CustomRole.exists({ code: input.code })) throw bad('A custom role with this code already exists', { code: 'Already exists' })
    const doc = await CustomRole.create({ ...input, createdBy: user.id })
    await audit(user, 'role.create', 'role', doc._id, { after: input, label: input.name }, clientMeta(req, user))
    return { id: String(doc._id) }
  },
  { roles: ['SUPER_ADMIN'] },
)
