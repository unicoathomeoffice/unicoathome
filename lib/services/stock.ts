import 'server-only'
import { z } from 'zod'
import { Equipment, HomecareRequest, StockMove, User } from '../models'
import { audit, type Meta } from '../audit'
import { bad, notFound } from '../api'
import { background, notifyRoles } from '../messaging'
import type { SessionUser } from '../auth'

// The store (Settings → Equipment & consumables): each item's stock count, kept by an append-only ledger (StockMove).
// Consumables recorded on a visit are taken out of the store automatically and given back when the visit's record is
// corrected, cancelled or deleted. Equipment comes back after the visit, so it is never taken out.

type Reason = 'OPENING' | 'RECEIVED' | 'VISIT' | 'ADJUST' | 'MANUAL' | 'LOAN_IN' | 'LOAN_OUT' | 'LOAN_RETURN_IN' | 'LOAN_RETURN_OUT'
type Actor = Pick<SessionUser, 'id' | 'name' | 'role'> | null

/** Change an item's stock by `delta` (atomic) and log the move with the new balance. */
export async function moveStock(itemId: unknown, delta: number, reason: Reason, opts: { requestId?: unknown; consumptionId?: unknown; loanId?: unknown; fixOf?: unknown; note?: string; by?: string } = {}) {
  if (!delta) return null
  const item = await Equipment.findOneAndUpdate({ _id: itemId }, { $inc: { stock: delta } }, { new: true }).select('name unit stock alertBelow type').lean<any>()
  if (!item) return null
  await StockMove.create({ itemId, delta, balance: item.stock, reason, requestId: opts.requestId, consumptionId: opts.consumptionId, loanId: opts.loanId, fixOf: opts.fixOf, note: opts.note, by: opts.by })
  // used on a visit and now low / out: tell the admins (once per crossing)
  if (delta < 0) {
    const before = item.stock - delta
    const low = item.alertBelow > 0 ? item.alertBelow : 0
    if ((item.stock <= low && before > low) || (item.stock <= 0 && before > 0))
      background(() =>
        notifyRoles(['HC_ADMIN', 'SUPER_ADMIN'], {
          type: 'SYSTEM',
          title: item.stock <= 0 ? `${item.name} — out of stock` : `${item.name} low — ${item.stock} ${item.unit} left`,
          body: 'Store · Equipment & consumables',
          url: '/store',
          priority: item.stock <= 0 ? 'high' : 'normal',
        }),
      )
  }
  return item
}

/**
 * Make the store match what a visit used: for every catalog consumable on the visit, the store has given exactly the
 * recorded quantity (more recorded → taken out, less / removed → put back). Safe to call any number of times.
 * `giveBack`: the visit no longer counts (cancelled / deleted) — everything it took goes back.
 */
export async function syncVisitStock(requestId: unknown, user: Actor, opts: { giveBack?: boolean } = {}, meta: Meta = {}) {
  const r = await HomecareRequest.findById(requestId).select('requestNo patientSnapshot.name visit.consumables').lean<any>()
  if (!r) return []
  const want = new Map<string, number>()
  if (!opts.giveBack) for (const c of r.visit?.consumables ?? []) if (c.itemId && c.qty > 0) want.set(String(c.itemId), (want.get(String(c.itemId)) ?? 0) + c.qty)
  const taken = await StockMove.aggregate([{ $match: { requestId: r._id, reason: 'VISIT' } }, { $group: { _id: '$itemId', out: { $sum: '$delta' } } }])
  const ids = [...new Set([...want.keys(), ...taken.map((t) => String(t._id))])]
  if (!ids.length) return []
  const items = await Equipment.find({ _id: { $in: ids } }).select('name type unit').lean<any[]>()
  const changes: string[] = []
  for (const id of ids) {
    const item = items.find((i) => String(i._id) === id)
    if (!item) continue
    const already = -(taken.find((t) => String(t._id) === id)?.out ?? 0) // how many this visit has taken so far
    const target = item.type === 'CONSUMABLE' ? (want.get(id) ?? 0) : 0 // equipment comes back: never taken
    const diff = target - already
    if (!diff) continue
    const note = `${diff > 0 ? 'Used on visit' : opts.giveBack ? 'Given back (visit cancelled / deleted)' : 'Corrected on visit'} · ${r.patientSnapshot?.name ?? r.requestNo}`
    await moveStock(id, -diff, 'VISIT', { requestId: r._id, note, by: user?.id })
    changes.push(`${item.name} ${diff > 0 ? '−' : '+'}${Math.abs(diff)}`)
  }
  if (changes.length) await audit(user, 'stock.visit', 'request', r._id, { after: { store: changes }, label: r.requestNo }, meta)
  return changes
}

/** Never throws — a store hiccup must not stop the visit record from saving. */
export async function syncVisitStockQuietly(requestId: unknown, user: Actor, opts: { giveBack?: boolean } = {}, meta: Meta = {}) {
  try {
    return await syncVisitStock(requestId, user, opts, meta)
  } catch (e) {
    console.error('[stock]', e)
    return []
  }
}

export const StockInput = z.object({
  action: z.enum(['receive', 'count', 'adjust']), // adjust: + / − qty with a required reason (found, damaged, mistake…)
  qty: z.coerce.number().int().min(-100000).max(1000000),
  note: z.string().trim().max(200).optional(),
})

/** Admin: "Received +N" (new stock in) or "Counted N" (stock-take: sets the count, the difference is logged). */
export async function changeStock(itemId: string, input: z.infer<typeof StockInput>, user: SessionUser, meta: Meta = {}) {
  const item = await Equipment.findById(itemId).select('name stock unit').lean<any>()
  if (!item) throw notFound('Item')
  const delta = input.action === 'count' ? input.qty - (item.stock ?? 0) : input.qty
  if (input.action === 'receive' && input.qty <= 0) throw bad('Enter how many were received')
  if (input.action === 'adjust' && (!input.qty || !input.note || input.note.length < 3)) throw bad('Enter + or − qty and the reason')
  if (!delta) return { stock: item.stock ?? 0, delta: 0 }
  const after = await moveStock(itemId, delta, input.action === 'receive' ? 'RECEIVED' : 'ADJUST', { note: input.action === 'adjust' ? `Adjusted · ${input.note}` : input.note || (input.action === 'receive' ? 'Received' : 'Stock count'), by: user.id })
  await audit(user, input.action === 'receive' ? 'stock.receive' : 'stock.adjust', 'equipment', itemId, { before: { stock: item.stock ?? 0 }, after: { stock: after?.stock, delta, note: input.note }, label: item.name }, meta)
  return { stock: after?.stock ?? 0, delta }
}

/** The last moves of an item, with who and which visit. */
export async function stockHistory(itemId: string, limit = 30) {
  const moves = await StockMove.find({ itemId }).sort({ at: -1 }).limit(limit).lean<any[]>()
  const [users, reqs] = await Promise.all([
    User.find({ _id: { $in: [...new Set(moves.map((m) => String(m.by ?? '')).filter(Boolean))] } }).select('name').lean<any[]>(),
    HomecareRequest.find({ _id: { $in: [...new Set(moves.map((m) => String(m.requestId ?? '')).filter(Boolean))] } }).select('requestNo patientSnapshot.name').lean<any[]>(),
  ])
  return moves.map((m) => {
    const q = reqs.find((x) => String(x._id) === String(m.requestId))
    return {
      id: String(m._id),
      at: new Date(m.at).toISOString(),
      delta: m.delta,
      balance: m.balance ?? null,
      reason: m.reason as Reason,
      note: m.note ?? '',
      by: users.find((u) => String(u._id) === String(m.by))?.name ?? null,
      requestId: q ? String(q._id) : null,
      requestNo: q?.requestNo ?? null,
      consumptionId: m.consumptionId ? String(m.consumptionId) : null,
      loanId: m.loanId ? String(m.loanId) : null,
      fix: !!m.fixOf, // this move is a correction of another
      fixedTo: typeof m.fixedTo === 'number' ? m.fixedTo : null,
      fixes: (m.fixes ?? []).map((f: any) => ({ at: new Date(f.at).toISOString(), by: users.find((u) => String(u._id) === String(f.by))?.name ?? null, why: f.why ?? '', from: f.from, to: f.to })),
    }
  })
}

const MOVE_LABEL: Partial<Record<Reason, string>> = { OPENING: 'opening stock', RECEIVED: 'received', ADJUST: 'adjustment' }
export const CorrectMoveInput = z.object({
  qty: z.coerce.number().int().min(-1000000).max(1000000), // what the entry should have been (signed for adjustments; 0 = cancel it)
  why: z.string().trim().min(3, 'Say why').max(160),
})

/**
 * Correct a wrong stock entry (opening stock, received, an adjustment) without rewriting history: the entry keeps its
 * number and records what it should have been, and a new correction move puts the stock right by the difference.
 * Consumption, loans and visits are corrected in their own place (their edit keeps the moves in step).
 */
export async function correctMove(itemId: string, moveId: string, input: z.infer<typeof CorrectMoveInput>, user: SessionUser, meta: Meta = {}) {
  const m = await StockMove.findOne({ _id: moveId, itemId }).lean<any>()
  if (!m) throw notFound('Entry')
  if (m.fixOf) throw bad('This is a correction — correct the original entry instead')
  if (m.reason === 'MANUAL') throw bad('Edit this in Store → Consumption')
  if (String(m.reason).startsWith('LOAN')) throw bad('Edit this in Store → Loans')
  if (m.reason === 'VISIT') throw bad('Change the consumables on the visit record')
  if ((m.reason === 'OPENING' || m.reason === 'RECEIVED') && input.qty < 0) throw bad('Received / opening stock cannot be below 0')
  const was = typeof m.fixedTo === 'number' ? m.fixedTo : m.delta
  const diff = input.qty - was
  if (!diff) throw bad('That is the same number')
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n))
  const day = new Date(m.at).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })
  const label = MOVE_LABEL[m.reason as Reason] ?? 'entry'
  const after = await moveStock(itemId, diff, 'ADJUST', { fixOf: m._id, note: `Corrected ${label} of ${day} (was ${sign(was)}, now ${sign(input.qty)}) · ${input.why}`, by: user.id })
  if (!after) throw notFound('Item')
  await StockMove.updateOne({ _id: m._id }, { $set: { fixedTo: input.qty }, $push: { fixes: { at: new Date(), by: user.id, why: input.why, from: was, to: input.qty } } })
  await audit(user, 'stock.move_fix', 'equipment', itemId, { before: { move: moveId, qty: was, stock: after.stock - diff }, after: { qty: input.qty, stock: after.stock, why: input.why }, label: after.name }, meta)
  return { ok: true, stock: after.stock as number, delta: diff }
}

export const ReceiveInput = z.object({
  items: z.array(z.object({ itemId: z.string().regex(/^[a-f0-9]{24}$/i), qty: z.coerce.number().int().min(1).max(1000000) })).min(1, 'Add at least one item').max(80),
  ref: z.string().trim().max(60).optional(), // H360 indent / issue no, supplier invoice…
  from: z.string().trim().max(80).optional(), // "Central store (H360 indent)", supplier
  note: z.string().trim().max(200).optional(),
})

/** Several items received at once (H360 indent, supplier) — one RECEIVED move each, one audit row. */
export async function receiveItems(input: z.infer<typeof ReceiveInput>, user: SessionUser, meta: Meta = {}) {
  const merged = new Map<string, number>()
  for (const x of input.items) merged.set(x.itemId, (merged.get(x.itemId) ?? 0) + x.qty)
  const items = await Equipment.find({ _id: { $in: [...merged.keys()] } }).select('name').lean<any[]>()
  if (items.length !== merged.size) throw bad('An item is no longer in the store')
  const note = ['Received', input.from && `from ${input.from}`, input.ref && `ref ${input.ref}`, input.note].filter(Boolean).join(' · ')
  for (const [id, qty] of merged) await moveStock(id, qty, 'RECEIVED', { note, by: user.id })
  await audit(user, 'stock.receive', 'store', input.ref ?? 'receive', { after: { from: input.from, ref: input.ref, items: [...merged].map(([id, q]) => `${items.find((i) => String(i._id) === id)?.name} × ${q}`) } }, meta)
  return { ok: true, count: merged.size }
}

/** The store ledger: every move with item, reason, balance, who and the visit / loan / consumption it belongs to. */
export async function listMoves(f: { itemId?: string; reason?: string; from?: string; to?: string } = {}, limit = 500) {
  const q: Record<string, unknown> = {}
  if (f.itemId && /^[a-f0-9]{24}$/i.test(f.itemId)) q.itemId = f.itemId
  if (f.reason) q.reason = f.reason === 'LOAN' ? { $in: ['LOAN_IN', 'LOAN_OUT', 'LOAN_RETURN_IN', 'LOAN_RETURN_OUT'] } : f.reason
  const at: Record<string, Date> = {}
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) at.$gte = new Date(`${f.from}T00:00:00+06:00`)
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) at.$lt = new Date(new Date(`${f.to}T00:00:00+06:00`).getTime() + 86400_000)
  if (Object.keys(at).length) q.at = at
  const moves = await StockMove.find(q).sort({ at: -1 }).limit(limit).lean<any[]>()
  const [items, users, reqs] = await Promise.all([
    Equipment.find({ _id: { $in: [...new Set(moves.map((m) => String(m.itemId)))] } }).select('name unit').lean<any[]>(),
    User.find({ _id: { $in: [...new Set(moves.map((m) => String(m.by ?? '')).filter(Boolean))] } }).select('name').lean<any[]>(),
    HomecareRequest.find({ _id: { $in: [...new Set(moves.map((m) => String(m.requestId ?? '')).filter(Boolean))] } }).select('requestNo patientSnapshot.name').lean<any[]>(),
  ])
  return moves.map((m) => {
    const it = items.find((i) => String(i._id) === String(m.itemId))
    const r = reqs.find((x) => String(x._id) === String(m.requestId))
    return {
      id: String(m._id),
      at: new Date(m.at).toISOString(),
      itemId: String(m.itemId),
      item: it?.name ?? 'Item',
      unit: it?.unit ?? '',
      delta: m.delta,
      balance: m.balance ?? null,
      reason: m.reason as string,
      note: m.note ?? '',
      by: users.find((u) => String(u._id) === String(m.by))?.name ?? null,
      requestId: r ? String(r._id) : null,
      requestNo: r?.requestNo ?? null,
      patient: r?.patientSnapshot?.name ?? null,
    }
  })
}
