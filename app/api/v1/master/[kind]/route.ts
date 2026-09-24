import { route, body, clientMeta, notFound, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'
import { MASTER } from '@/lib/master'

/** GET /api/v1/master/:kind — kinds: departments · designations · zones · service-types · vehicles */
export const GET = route<{ kind: string }>(async ({ params }) => {
  const m = MASTER[params.kind]
  if (!m) throw notFound('List')
  const items = await m.model.find({}).sort(m.sort).lean<any[]>()
  if (m.usage) {
    const counts = await m.usage(items.map((i) => i._id))
    for (const i of items) i.inUse = counts[String(i._id)] ?? 0
  }
  return { items: plain(items) }
})

export const POST = route<{ kind: string }>(async ({ req, user, params }) => {
  const m = MASTER[params.kind]
  if (!m) throw notFound('List')
  if (!can(user.role, m.perm)) throw forbidden()
  const input = await body(req, m.schema)
  const doc = await m.model.create(input)
  await audit(user, `${m.entity}.create`, m.entity, doc._id, { after: input, label: (input as any).name ?? (input as any).title ?? (input as any).plate }, clientMeta(req, user))
  return { id: String(doc._id) }
})
