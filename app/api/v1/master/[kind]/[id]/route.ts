import { route, body, clientMeta, notFound, forbidden, bad } from '@/lib/api'
import { can } from '@/lib/constants'
import { audit, diff } from '@/lib/audit'
import { isOid } from '@/lib/models'
import { MASTER } from '@/lib/master'

export const PATCH = route<{ kind: string; id: string }>(async ({ req, user, params }) => {
  const m = MASTER[params.kind]
  if (!m || !isOid(params.id)) throw notFound('Record')
  if (!can(user.role, m.perm)) throw forbidden()
  const doc = await m.model.findById(params.id)
  if (!doc) throw notFound('Record')
  const input = (await body(req, m.schema.partial())) as Record<string, unknown>
  const before = doc.toObject()
  doc.set(input)
  await doc.save()
  await audit(user, `${m.entity}.update`, m.entity, doc._id, { ...diff(pickKeys(before, input), pickKeys(doc.toObject(), input)), label: doc.name ?? doc.title ?? doc.plate }, clientMeta(req, user))
  return { ok: true }
})

/** Delete is blocked when the record is in use — deactivate instead (plan §5.2). */
export const DELETE = route<{ kind: string; id: string }>(async ({ req, user, params }) => {
  const m = MASTER[params.kind]
  if (!m || !isOid(params.id)) throw notFound('Record')
  if (!can(user.role, m.perm)) throw forbidden()
  if (m.usage) {
    const n = (await m.usage([params.id]))[params.id] ?? 0
    if (n > 0) throw bad(`In use by ${n} record${n === 1 ? '' : 's'}. Deactivate it instead.`)
  }
  const doc = await m.model.findByIdAndDelete(params.id)
  if (!doc) throw notFound('Record')
  await audit(user, `${m.entity}.delete`, m.entity, params.id, { before: doc.toObject(), label: doc.name ?? doc.title ?? doc.plate }, clientMeta(req, user))
  return { ok: true }
})

function pickKeys(o: any, keys: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(keys)) out[k] = o?.[k]
  return out
}
