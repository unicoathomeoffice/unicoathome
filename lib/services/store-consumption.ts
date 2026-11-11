import 'server-only'
import { z } from 'zod'
import { Equipment, HomecareRequest, StockMove, StoreConsumption, User } from '../models'
import { audit, type Meta } from '../audit'
import { bad, conflict, notFound } from '../api'
import { moveStock } from './stock'
import type { SessionUser } from '../auth'

// Consumption entered by hand by a store admin — the HomeCare counterpart of H360's Department Consumption: several
// items at once with a reason (used in clinic, given to a patient, wastage, expired, transfer…). Takes the stock out
// (StockMove reason MANUAL) and can be voided, which puts it back. Never touches H360.

export const CONSUMPTION_REASONS = {
  CLINIC: 'Used in clinic / OPD',
  PATIENT: 'Given to a patient',
  WASTAGE: 'Wastage / damaged',
  EXPIRED: 'Expired',
  TRANSFER: 'Transfer to another department',
  OTHER: 'Other',
} as const
export type ConsumptionReason = keyof typeof CONSUMPTION_REASONS

export const ConsumptionInput = z.object({
  items: z.array(z.object({ itemId: z.string().regex(/^[a-f0-9]{24}$/i), qty: z.coerce.number().int().min(1).max(100000) })).min(1, 'Add at least one item').max(60),
  reason: z.enum(Object.keys(CONSUMPTION_REASONS) as [ConsumptionReason, ...ConsumptionReason[]]),
  requestNo: z.string().trim().max(30).optional(), // optional link to a visit (HC-…)
  note: z.string().trim().max(300).optional(),
  at: z.string().optional(), // ISO date-time, default now
})

/** SC-YYMMDD-NN, Dhaka date */
async function nextNo(at: Date) {
  const d = at.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', year: '2-digit', month: '2-digit', day: '2-digit' }).split('/').reverse().join('')
  const n = await StoreConsumption.countDocuments({ no: new RegExp(`^SC-${d}-`) })
  return `SC-${d}-${String(n + 1).padStart(2, '0')}`
}

export async function createConsumption(input: z.infer<typeof ConsumptionInput>, user: SessionUser, meta: Meta = {}) {
  const merged = new Map<string, number>()
  for (const x of input.items) merged.set(x.itemId, (merged.get(x.itemId) ?? 0) + x.qty)
  const items = await Equipment.find({ _id: { $in: [...merged.keys()] } }).select('name unit stock type').lean<any[]>()
  if (items.length !== merged.size) throw bad('An item is no longer in the store')
  const at = input.at ? new Date(input.at) : new Date()
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60_000) throw bad('Pick a date and time that has passed')
  let req: any = null
  if (input.requestNo) {
    req = await HomecareRequest.findOne({ requestNo: input.requestNo.toUpperCase(), deletedAt: null }).select('requestNo patientSnapshot.name').lean<any>()
    if (!req) throw bad(`No visit ${input.requestNo}`, { requestNo: 'Not found' })
  }
  let no = await nextNo(at)
  let doc: any
  for (let tries = 0; ; tries++) {
    try {
      doc = await StoreConsumption.create({
        no,
        items: [...merged.entries()].map(([id, qty]) => {
          const it = items.find((i) => String(i._id) === id)!
          return { itemId: it._id, name: it.name, unit: it.unit, qty }
        }),
        reason: input.reason,
        requestId: req?._id,
        patientName: req?.patientSnapshot?.name,
        note: input.note,
        at,
        by: user.id,
      })
      break
    } catch (e: any) {
      if (e?.code !== 11000 || tries > 4) throw e
      no = `${no.slice(0, 10)}${String(Number(no.slice(10)) + 1).padStart(2, '0')}` // two admins at the same moment
    }
  }
  const label = CONSUMPTION_REASONS[input.reason]
  for (const it of doc.items) await moveStock(it.itemId, -it.qty, 'MANUAL', { consumptionId: doc._id, requestId: req?._id, note: `${doc.no} · ${label}${input.note ? ` · ${input.note}` : ''}`, by: user.id })
  await audit(user, 'stock.consume', 'store', doc._id, { after: { no: doc.no, reason: input.reason, items: doc.items.map((i: any) => `${i.name} × ${i.qty}`), requestNo: req?.requestNo, note: input.note }, label: doc.no }, meta)
  return { id: String(doc._id), no: doc.no, short: doc.items.filter((i: any) => (items.find((x) => String(x._id) === String(i.itemId))?.stock ?? 0) < i.qty).map((i: any) => i.name) }
}

export const ConsumptionEdit = ConsumptionInput.extend({ why: z.string().trim().min(3, 'Say why it is changed').max(200) })

/**
 * Correct a consumption entered wrongly (items, quantities, reason, time, visit, note). History is kept: the stock is
 * put right with correction moves for the difference, and the entry records who changed what and why.
 */
export async function editConsumption(id: string, input: z.infer<typeof ConsumptionEdit>, user: SessionUser, meta: Meta = {}) {
  const doc = await StoreConsumption.findById(id)
  if (!doc) throw notFound('Consumption')
  if (doc.voidedAt) throw conflict('VOIDED', `${doc.no} was voided — it can't be changed`)
  const next = new Map<string, number>()
  for (const x of input.items) next.set(x.itemId, (next.get(x.itemId) ?? 0) + x.qty)
  const prev = new Map<string, number>(doc.items.map((i: any) => [String(i.itemId), i.qty]))
  const items = await Equipment.find({ _id: { $in: [...new Set([...next.keys(), ...prev.keys()])] } }).select('name unit').lean<any[]>()
  if ([...next.keys()].some((k) => !items.find((i) => String(i._id) === k))) throw bad('An item is no longer in the store')
  let req: any = null
  if (input.requestNo) {
    req = await HomecareRequest.findOne({ requestNo: input.requestNo.toUpperCase(), deletedAt: null }).select('requestNo patientSnapshot.name').lean<any>()
    if (!req) throw bad(`No visit ${input.requestNo}`, { requestNo: 'Not found' })
  }
  const before = { items: doc.items.map((i: any) => ({ name: i.name, qty: i.qty })), reason: doc.reason, note: doc.note, at: doc.at, requestId: doc.requestId }
  const changes: string[] = []
  for (const k of new Set([...next.keys(), ...prev.keys()])) {
    const was = prev.get(k) ?? 0
    const now = next.get(k) ?? 0
    if (was === now) continue
    const name = items.find((i) => String(i._id) === k)?.name ?? 'Item'
    await moveStock(k, -(now - was), 'MANUAL', { consumptionId: doc._id, note: `Corrected ${doc.no} (${name}: was ${was}, now ${now}) · ${input.why}`, by: user.id })
    changes.push(`${name} ${was} → ${now}`)
  }
  doc.items = [...next.entries()].map(([k, qty]) => {
    const it = items.find((i) => String(i._id) === k)!
    return { itemId: it._id, name: it.name, unit: it.unit, qty }
  })
  doc.reason = input.reason
  doc.note = input.note
  if (input.at) doc.at = new Date(input.at)
  doc.requestId = req?._id
  doc.patientName = req?.patientSnapshot?.name
  doc.edits.push({ at: new Date(), by: user.id, why: input.why, before, after: { items: doc.items.map((i: any) => ({ name: i.name, qty: i.qty })), reason: doc.reason, note: doc.note, at: doc.at } })
  await doc.save()
  await audit(user, 'stock.consume_edit', 'store', doc._id, { before, after: { items: changes, reason: input.reason, why: input.why }, label: doc.no }, meta)
  return { ok: true, no: doc.no, changes }
}

/** Undo a consumption entered by mistake: the stock goes back, the entry stays (marked voided). */
export async function voidConsumption(id: string, reason: string, user: SessionUser, meta: Meta = {}) {
  const doc = await StoreConsumption.findOneAndUpdate({ _id: id, voidedAt: null }, { $set: { voidedAt: new Date(), voidedBy: user.id, voidReason: reason } }, { new: true }).lean<any>()
  if (!doc) {
    if (await StoreConsumption.exists({ _id: id })) throw conflict('ALREADY_VOIDED', 'This consumption was already voided')
    throw notFound('Consumption')
  }
  for (const it of doc.items) await moveStock(it.itemId, it.qty, 'ADJUST', { consumptionId: doc._id, note: `Voided ${doc.no}${reason ? ` · ${reason}` : ''}`, by: user.id })
  await audit(user, 'stock.consume_void', 'store', doc._id, { after: { no: doc.no, reason }, label: doc.no }, meta)
  return { ok: true }
}

export async function listConsumptions(f: { month?: string; reason?: string } = {}, limit = 200) {
  const q: Record<string, unknown> = {}
  if (f.reason && f.reason in CONSUMPTION_REASONS) q.reason = f.reason
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const start = new Date(`${f.month}-01T00:00:00+06:00`)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    q.at = { $gte: start, $lt: end }
  }
  const rows = await StoreConsumption.find(q).sort({ at: -1 }).limit(limit).lean<any[]>()
  const users = await User.find({ _id: { $in: [...new Set(rows.flatMap((r) => [r.by, r.voidedBy, ...(r.edits ?? []).map((e: any) => e.by)]).filter(Boolean).map(String))] } }).select('name').lean<any[]>()
  const nameOf = (id: unknown) => users.find((u) => String(u._id) === String(id))?.name ?? null
  const reqs = await HomecareRequest.find({ _id: { $in: rows.map((r) => r.requestId).filter(Boolean) } }).select('requestNo').lean<any[]>()
  return rows.map((r) => ({
    requestNo: reqs.find((q) => String(q._id) === String(r.requestId))?.requestNo ?? null,
    id: String(r._id),
    no: r.no,
    at: new Date(r.at).toISOString(),
    reason: r.reason as ConsumptionReason,
    items: r.items.map((i: any) => ({ itemId: String(i.itemId), name: i.name, unit: i.unit, qty: i.qty })),
    requestId: r.requestId ? String(r.requestId) : null,
    patientName: r.patientName ?? null,
    note: r.note ?? '',
    by: nameOf(r.by),
    voidedAt: r.voidedAt ? new Date(r.voidedAt).toISOString() : null,
    voidedBy: nameOf(r.voidedBy),
    voidReason: r.voidReason ?? null,
    edits: (r.edits ?? []).map((e: any) => ({ at: new Date(e.at).toISOString(), by: nameOf(e.by), why: e.why ?? '', before: (e.before?.items ?? []).map((i: any) => `${i.name} × ${i.qty}`).join(', '), after: (e.after?.items ?? []).map((i: any) => `${i.name} × ${i.qty}`).join(', ') })),
  }))
}

/** For the H360 match: manual consumption per item since a date (not voided). */
export async function manualSince(itemIds: unknown[], since: Map<string, Date | null>) {
  const moves = await StockMove.find({ itemId: { $in: itemIds }, reason: 'MANUAL' }).select('itemId delta at consumptionId').lean<any[]>()
  const voided = new Set((await StoreConsumption.find({ _id: { $in: moves.map((m) => m.consumptionId).filter(Boolean) }, voidedAt: { $ne: null } }).select('_id').lean<any[]>()).map((c) => String(c._id)))
  const out = new Map<string, number>()
  for (const m of moves) {
    if (m.consumptionId && voided.has(String(m.consumptionId))) continue
    const s = since.get(String(m.itemId))
    if (s && m.at < s) continue
    out.set(String(m.itemId), (out.get(String(m.itemId)) ?? 0) - m.delta)
  }
  return out
}
