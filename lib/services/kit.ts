import 'server-only'
import { z } from 'zod'
import { Equipment, HomecareRequest, ServiceType, User } from '../models'
import { audit } from '../audit'
import { bad, conflict, forbidden, notFound } from '../api'
import { can } from '../constants'
import type { SessionUser } from '../auth'
import { isTeamMember } from './requests'

// The bag for a visit: what the team takes, from its services' kits (Settings → Services → Bag & consumables).
// Each item has a recommended quantity and a minimum that must be packed before "Start journey" (0 = optional).
// The request keeps its own copy (visit.kit) with what was packed, by whom and when.

type Meta = { ip?: string; userAgent?: string; client?: string }

/** One bag for a request with several services: the same item once, with the larger of each quantity. */
export async function buildKit(serviceTypeIds: unknown[]) {
  const types = await ServiceType.find({ _id: { $in: serviceTypeIds.filter(Boolean) } }).select('kit').lean<any[]>()
  const rows = new Map<string, { recommendedQty: number; minQty: number; usualUse: number }>()
  for (const t of types)
    for (const k of t.kit ?? []) {
      const id = String(k.itemId)
      const cur = rows.get(id)
      rows.set(id, { recommendedQty: Math.max(cur?.recommendedQty ?? 0, k.recommendedQty ?? 1), minQty: Math.max(cur?.minQty ?? 0, k.minQty ?? 0), usualUse: Math.max(cur?.usualUse ?? 0, k.usualUse ?? 0) })
    }
  if (!rows.size) return []
  const items = await Equipment.find({ _id: { $in: [...rows.keys()] } }).select('name type unit imageId').lean<any[]>()
  return [...rows.entries()]
    .map(([id, q]) => {
      const e = items.find((x) => String(x._id) === id)
      return e ? { itemId: e._id, name: e.name, type: e.type, unit: e.unit, imageId: e.imageId, recommendedQty: q.recommendedQty, minQty: Math.min(q.minQty, Math.max(q.recommendedQty, q.minQty)), usualUse: e.type === 'CONSUMABLE' ? q.usualUse : 0, packedQty: 0 } : null
    })
    .filter(Boolean) as any[]
}

/** Visits created before bags existed (or before the service had one): build it on first use, until the journey starts. */
export async function ensureKit(r: any) {
  if (r.visit?.kitSet) return r.visit.kit ?? []
  const kit = await buildKit((r.services ?? []).map((s: any) => s.serviceTypeId))
  await HomecareRequest.updateOne({ _id: r._id, 'visit.kitSet': { $ne: true } }, { $set: { 'visit.kitSet': true, 'visit.kit': kit } })
  if (r.set) {
    r.set('visit.kitSet', true)
    r.set('visit.kit', kit)
  } else r.visit = { ...(r.visit ?? {}), kitSet: true, kit }
  return kit
}

/** Items still short of their must-take quantity. */
export const kitMissing = (r: any) => (r.visit?.kit ?? []).filter((k: any) => (k.minQty ?? 0) > 0 && (k.packedQty ?? 0) < k.minQty)

/** "Pack first: IV cannula (1), Gloves (2)" — or null when the bag is ready. */
export function kitBlock(r: any) {
  const m = kitMissing(r)
  return m.length ? `Pack first: ${m.map((k: any) => `${k.name} (${k.minQty})`).join(', ')}` : null
}

export const PackInput = z.object({ packedQty: z.coerce.number().int().min(0).max(99) })

/** Pack (or unpack) an item: the care team, or someone acting for them (outside staff → coordinators). */
export async function packKit(r: any, itemId: string, input: z.infer<typeof PackInput>, user: SessionUser, opts: { actsForTeam: boolean }, meta: Meta = {}) {
  if (!isTeamMember(user, r) && !opts.actsForTeam) throw forbidden('Only the care team packs the bag')
  if (!['ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(r.status)) throw conflict('JOURNEY_STARTED', 'The journey has started — the bag is already packed')
  await ensureKit(r)
  const list: any[] = r.visit.kit
  const i = list.findIndex((k) => String(k.itemId) === itemId)
  if (i < 0) throw notFound('Bag item')
  await HomecareRequest.updateOne({ _id: r._id }, { $set: { [`visit.kit.${i}.packedQty`]: input.packedQty, [`visit.kit.${i}.packedAt`]: new Date(), [`visit.kit.${i}.packedBy`]: user.id } })
  await audit(user, 'visit.kit_pack', 'request', r._id, { after: { item: list[i].name, packed: input.packedQty, mustTake: list[i].minQty }, label: r.requestNo }, meta)
  return { ok: true }
}

/** Rows for the bag card (with who packed). */
export async function kitRows(r: any) {
  const list: any[] = await ensureKit(r)
  const ids = [...new Set(list.map((k) => k.packedBy).filter(Boolean).map(String))]
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean<any[]>() : []
  return list.map((k) => ({
    itemId: String(k.itemId),
    name: k.name,
    type: k.type,
    unit: k.unit,
    imageId: k.imageId ? String(k.imageId) : null,
    recommendedQty: k.recommendedQty ?? 1,
    minQty: k.minQty ?? 0,
    packedQty: k.packedQty ?? 0,
    packedAt: k.packedAt ? new Date(k.packedAt).toISOString() : null,
    packedByName: users.find((u) => String(u._id) === String(k.packedBy))?.name ?? null,
  }))
}

// ---------------------------------------------------------------- consumables used
export const ConsumablesInput = z.object({ items: z.array(z.object({ itemId: z.string(), qty: z.coerce.number().min(0).max(999) })).max(80) })

/**
 * Save what was used on the visit (catalog items). Rows with qty 0 are removed; free-text rows added on the Notes
 * screen are kept. The team from check-in until the visit is closed; coordinators any time (corrections).
 */
export async function saveConsumables(r: any, input: z.infer<typeof ConsumablesInput>, user: SessionUser, opts: { actsForTeam: boolean }, meta: Meta = {}) {
  const coordinator = can(user, 'requests.manage')
  if (!isTeamMember(user, r) && !opts.actsForTeam && !coordinator) throw forbidden('Only the care team or a coordinator can record consumables')
  if (!coordinator && !r.timeline?.checkInAt) throw conflict('NOT_CHECKED_IN', 'Record consumables once the visit has started')
  if (!coordinator && r.status === 'CLOSED') throw conflict('CLOSED', 'This visit is closed — ask a coordinator to correct it')
  const ids = [...new Set(input.items.map((x) => x.itemId))]
  if (!ids.every((x) => /^[a-f0-9]{24}$/i.test(x))) throw bad('Invalid item')
  const items = await Equipment.find({ _id: { $in: ids } }).select('name unit').lean<any[]>()
  const prev: any[] = r.visit?.consumables ?? []
  const now = new Date()
  const catalogRows = input.items
    .filter((x) => x.qty > 0)
    .map((x) => {
      const e = items.find((i) => String(i._id) === x.itemId)
      if (!e) throw bad('Unknown item')
      const old = prev.find((p) => p.itemId && String(p.itemId) === x.itemId)
      const same = old && old.qty === x.qty
      return { item: e.name, itemId: e._id, unit: e.unit, qty: x.qty, at: same ? old.at : now, by: same ? old.by : user.id }
    })
  const freeText = prev.filter((p) => !p.itemId)
  await HomecareRequest.updateOne({ _id: r._id }, { $set: { 'visit.consumables': [...catalogRows, ...freeText] } })
  await audit(user, 'visit.consumables', 'request', r._id, { after: { items: catalogRows.map((c) => `${c.item} × ${c.qty}`) }, label: r.requestNo }, meta)
  // the store gives exactly what was used: taken out now, put back if a correction lowers it
  const { syncVisitStockQuietly } = await import('./stock')
  const store = await syncVisitStockQuietly(r._id, user, {}, meta)
  return { ok: true, count: catalogRows.length, store }
}
