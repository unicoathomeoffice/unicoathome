import 'server-only'
import { z } from 'zod'
import { Equipment, HomecareRequest, StoreLoan, User } from '../models'
import { audit, type Meta } from '../audit'
import { bad, conflict, notFound } from '../api'
import { notifyRoles } from '../messaging'
import { moveStock } from './stock'
import type { SessionUser } from '../auth'

// Store loans. TAKEN: we borrowed from someone — stock goes up and we owe it back. GIVEN: we lent to someone — stock
// goes down and they owe it to us. Returns can be partial, item by item; a loan that will never come back is written
// off. The partner (a department, a staff member or an outside party) is typed by hand — no H360 lookup.

export const PartnerInput = z.object({
  kind: z.enum(['DEPARTMENT', 'STAFF', 'OUTSIDE']),
  name: z.string().trim().min(2, 'Who is it with?').max(80),
  phone: z.string().trim().max(20).optional(),
  userId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
})
export const LoanInput = z.object({
  direction: z.enum(['TAKEN', 'GIVEN']),
  partner: PartnerInput,
  items: z.array(z.object({ itemId: z.string().regex(/^[a-f0-9]{24}$/i), qty: z.coerce.number().int().min(1).max(100000) })).min(1, 'Add at least one item').max(60),
  dueAt: z.string().optional(), // YYYY-MM-DD
  note: z.string().trim().max(300).optional(),
  requestNo: z.string().trim().max(30).optional(),
})
export const LoanAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('return'), items: z.array(z.object({ itemId: z.string(), qty: z.coerce.number().int().min(0).max(100000) })).min(1), note: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('writeoff'), reason: z.string().trim().min(3, 'Say why').max(200) }),
  z.object({ action: z.literal('undo-return'), index: z.coerce.number().int().min(0), reason: z.string().trim().min(3, 'Say why').max(200) }),
  z.object({ action: z.literal('reopen'), reason: z.string().trim().min(3, 'Say why').max(200) }),
])
export const LoanEdit = LoanInput.omit({ direction: true }).extend({ why: z.string().trim().min(3, 'Say why it is changed').max(200) })

async function nextNo(direction: 'TAKEN' | 'GIVEN') {
  const d = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', year: '2-digit', month: '2-digit', day: '2-digit' }).split('/').reverse().join('')
  const p = `${direction === 'TAKEN' ? 'LT' : 'LG'}-${d}-`
  const n = await StoreLoan.countDocuments({ no: new RegExp(`^${p}`) })
  return `${p}${String(n + 1).padStart(2, '0')}`
}
const outstanding = (i: { qty: number; returnedQty?: number }) => Math.max(0, i.qty - (i.returnedQty ?? 0))

export async function createLoan(input: z.infer<typeof LoanInput>, user: SessionUser, meta: Meta = {}) {
  const merged = new Map<string, number>()
  for (const x of input.items) merged.set(x.itemId, (merged.get(x.itemId) ?? 0) + x.qty)
  const items = await Equipment.find({ _id: { $in: [...merged.keys()] } }).select('name unit stock').lean<any[]>()
  if (items.length !== merged.size) throw bad('An item is no longer in the store')
  let req: any = null
  if (input.requestNo) {
    req = await HomecareRequest.findOne({ requestNo: input.requestNo.toUpperCase(), deletedAt: null }).select('_id requestNo').lean<any>()
    if (!req) throw bad(`No visit ${input.requestNo}`)
  }
  const dueAt = input.dueAt ? new Date(`${input.dueAt}T23:59:00+06:00`) : undefined
  let doc: any
  let no = await nextNo(input.direction)
  for (let tries = 0; ; tries++) {
    try {
      doc = await StoreLoan.create({
        no,
        direction: input.direction,
        partner: { kind: input.partner.kind, name: input.partner.name, phone: input.partner.phone || undefined, userId: input.partner.userId },
        items: [...merged.entries()].map(([id, qty]) => {
          const it = items.find((i) => String(i._id) === id)!
          return { itemId: it._id, name: it.name, unit: it.unit, qty, returnedQty: 0 }
        }),
        dueAt,
        note: input.note,
        requestId: req?._id,
        by: user.id,
      })
      break
    } catch (e: any) {
      if (e?.code !== 11000 || tries > 4) throw e
      no = `${no.slice(0, 10)}${String(Number(no.slice(10)) + 1).padStart(2, '0')}`
    }
  }
  const taken = input.direction === 'TAKEN'
  for (const it of doc.items)
    await moveStock(it.itemId, taken ? it.qty : -it.qty, taken ? 'LOAN_IN' : 'LOAN_OUT', { loanId: doc._id, requestId: req?._id, note: `${doc.no} · ${taken ? 'borrowed from' : 'lent to'} ${input.partner.name}`, by: user.id })
  await audit(user, taken ? 'stock.loan_take' : 'stock.loan_give', 'store', doc._id, { after: { no: doc.no, partner: input.partner.name, items: doc.items.map((i: any) => `${i.name} × ${i.qty}`), dueAt }, label: doc.no }, meta)
  const short = taken ? [] : doc.items.filter((i: any) => (items.find((x) => String(x._id) === String(i.itemId))?.stock ?? 0) < i.qty).map((i: any) => i.name)
  return { id: String(doc._id), no: doc.no, short }
}

/** open / partly returned / returned from what is still out (a written-off loan stays written off) */
function restatus(loan: any) {
  if (loan.status === 'WRITTEN_OFF') return
  const left = loan.items.reduce((a: number, i: any) => a + outstanding(i), 0)
  const back = loan.items.reduce((a: number, i: any) => a + (i.returnedQty ?? 0), 0)
  loan.status = !left ? 'RETURNED' : back ? 'PARTLY_RETURNED' : 'OPEN'
  loan.closedAt = !left ? loan.closedAt ?? new Date() : undefined
}

/**
 * Correct a loan entered wrongly: partner (typed name / kind / phone), due date, note, items and quantities. A quantity
 * can't go below what already came back. The stock is put right with correction moves; the loan keeps an edit log.
 */
export async function editLoan(id: string, input: z.infer<typeof LoanEdit>, user: SessionUser, meta: Meta = {}) {
  const loan = await StoreLoan.findById(id)
  if (!loan) throw notFound('Loan')
  if (loan.status === 'WRITTEN_OFF') throw conflict('WRITTEN_OFF', `${loan.no} is written off — re-open it first`)
  const taken = loan.direction === 'TAKEN'
  const next = new Map<string, number>()
  for (const x of input.items) next.set(x.itemId, (next.get(x.itemId) ?? 0) + x.qty)
  const items = await Equipment.find({ _id: { $in: [...new Set([...next.keys(), ...loan.items.map((i: any) => String(i.itemId))])] } }).select('name unit').lean<any[]>()
  if ([...next.keys()].some((k) => !items.find((i) => String(i._id) === k))) throw bad('An item is no longer in the store')
  for (const i of loan.items) {
    const now = next.get(String(i.itemId)) ?? 0
    if (now < (i.returnedQty ?? 0)) throw bad(`${i.name}: ${i.returnedQty} already came back — it can't be less than that`)
  }
  let req: any = null
  if (input.requestNo) {
    req = await HomecareRequest.findOne({ requestNo: input.requestNo.toUpperCase(), deletedAt: null }).select('_id').lean<any>()
    if (!req) throw bad(`No visit ${input.requestNo}`)
  }
  const before = { partner: { ...loan.partner.toObject?.() ?? loan.partner }, items: loan.items.map((i: any) => ({ name: i.name, qty: i.qty })), dueAt: loan.dueAt, note: loan.note }
  const changes: string[] = []
  const prev = new Map<string, any>(loan.items.map((i: any) => [String(i.itemId), i]))
  for (const k of new Set([...next.keys(), ...prev.keys()])) {
    const was = prev.get(k)?.qty ?? 0
    const now = next.get(k) ?? 0
    if (was === now) continue
    const name = items.find((i) => String(i._id) === k)?.name ?? 'Item'
    const d = now - was
    await moveStock(k, taken ? d : -d, taken ? 'LOAN_IN' : 'LOAN_OUT', { loanId: loan._id, note: `Corrected ${loan.no} (${name}: was ${was}, now ${now}) · ${input.why}`, by: user.id })
    changes.push(`${name} ${was} → ${now}`)
  }
  loan.items = [...next.entries()].map(([k, qty]) => {
    const it = items.find((i) => String(i._id) === k)!
    return { itemId: it._id, name: it.name, unit: it.unit, qty, returnedQty: prev.get(k)?.returnedQty ?? 0 }
  })
  if (loan.partner.name !== input.partner.name) changes.push(`with: ${loan.partner.name} → ${input.partner.name}`)
  loan.partner = { kind: input.partner.kind, name: input.partner.name, phone: input.partner.phone || undefined, userId: input.partner.userId }
  loan.dueAt = input.dueAt ? new Date(`${input.dueAt}T23:59:00+06:00`) : undefined
  loan.note = input.note
  loan.requestId = req?._id
  restatus(loan)
  loan.edits.push({ at: new Date(), by: user.id, why: input.why, before, after: { partner: loan.partner, items: loan.items.map((i: any) => ({ name: i.name, qty: i.qty })), dueAt: loan.dueAt, note: loan.note } })
  loan.markModified('items')
  await loan.save()
  await audit(user, 'stock.loan_edit', 'store', loan._id, { before, after: { changes, why: input.why }, label: loan.no }, meta)
  return { ok: true, no: loan.no, changes }
}

export async function loanAction(id: string, input: z.infer<typeof LoanAction>, user: SessionUser, meta: Meta = {}) {
  const loan = await StoreLoan.findById(id)
  if (!loan) throw notFound('Loan')
  const taken = loan.direction === 'TAKEN'
  if (input.action === 'reopen') {
    if (loan.status !== 'WRITTEN_OFF') throw conflict('NOT_WRITTEN_OFF', `${loan.no} is not written off`)
    loan.status = 'OPEN'
    loan.writeOffReason = undefined
    loan.closedAt = undefined
    restatus(loan)
    loan.edits.push({ at: new Date(), by: user.id, why: input.reason, before: { status: 'WRITTEN_OFF' }, after: { status: loan.status } })
    await loan.save()
    await audit(user, 'stock.loan_reopen', 'store', loan._id, { after: { no: loan.no, reason: input.reason }, label: loan.no }, meta)
    return { ok: true, status: loan.status }
  }
  if (input.action === 'undo-return') {
    const r = loan.returns[input.index]
    if (!r) throw notFound('Return')
    if (r.undoneAt) throw conflict('ALREADY_UNDONE', 'This return was already undone')
    if (loan.status === 'WRITTEN_OFF') throw conflict('WRITTEN_OFF', `${loan.no} is written off — re-open it first`)
    for (const x of r.items) {
      const it = loan.items.find((i: any) => String(i.itemId) === String(x.itemId))
      if (it) it.returnedQty = Math.max(0, (it.returnedQty ?? 0) - x.qty)
      // the opposite of the return move: borrowed items we "gave back" are ours again / lent items "returned" are out again
      await moveStock(x.itemId, taken ? x.qty : -x.qty, taken ? 'LOAN_RETURN_OUT' : 'LOAN_RETURN_IN', { loanId: loan._id, note: `Return undone · ${loan.no} · ${input.reason}`, by: user.id })
    }
    r.undoneAt = new Date()
    r.undoneBy = user.id
    r.undoReason = input.reason
    restatus(loan)
    loan.markModified('items')
    loan.markModified('returns')
    await loan.save()
    await audit(user, 'stock.loan_return_undo', 'store', loan._id, { after: { no: loan.no, reason: input.reason, status: loan.status }, label: loan.no }, meta)
    return { ok: true, status: loan.status }
  }
  if (loan.status === 'RETURNED' || loan.status === 'WRITTEN_OFF') throw conflict('CLOSED', `${loan.no} is already ${loan.status === 'RETURNED' ? 'returned' : 'written off'}`)
  if (input.action === 'writeoff') {
    loan.status = 'WRITTEN_OFF'
    loan.writeOffReason = input.reason
    loan.closedAt = new Date()
    await loan.save()
    await audit(user, 'stock.loan_writeoff', 'store', loan._id, { after: { no: loan.no, reason: input.reason, outstanding: loan.items.map((i: any) => `${i.name} × ${outstanding(i)}`) }, label: loan.no }, meta)
    return { ok: true, status: loan.status }
  }
  const back: { itemId: string; qty: number }[] = []
  for (const r of input.items) {
    if (!r.qty) continue
    const it = loan.items.find((i: any) => String(i.itemId) === r.itemId)
    if (!it) throw bad('An item is not on this loan')
    if (r.qty > outstanding(it)) throw bad(`${it.name}: only ${outstanding(it)} still out`)
    it.returnedQty = (it.returnedQty ?? 0) + r.qty
    back.push({ itemId: r.itemId, qty: r.qty })
  }
  if (!back.length) throw bad('Enter how many came back')
  loan.returns.push({ at: new Date(), by: user.id, items: back, note: input.note })
  const left = loan.items.reduce((a: number, i: any) => a + outstanding(i), 0)
  loan.status = left ? 'PARTLY_RETURNED' : 'RETURNED'
  if (!left) loan.closedAt = new Date()
  loan.markModified('items')
  await loan.save()
  for (const b of back)
    await moveStock(b.itemId, taken ? -b.qty : b.qty, taken ? 'LOAN_RETURN_OUT' : 'LOAN_RETURN_IN', { loanId: loan._id, note: `${loan.no} · ${taken ? 'given back to' : 'returned by'} ${loan.partner.name}${input.note ? ` · ${input.note}` : ''}`, by: user.id })
  await audit(user, 'stock.loan_return', 'store', loan._id, { after: { no: loan.no, items: back.map((b) => `${loan.items.find((i: any) => String(i.itemId) === b.itemId)?.name} × ${b.qty}`), status: loan.status }, label: loan.no }, meta)
  return { ok: true, status: loan.status }
}

export type LoanRow = {
  id: string
  no: string
  direction: 'TAKEN' | 'GIVEN'
  partner: { kind: string; name: string; phone: string | null }
  items: { itemId: string; name: string; unit: string; qty: number; returnedQty: number; outstanding: number }[]
  status: string
  at: string
  dueAt: string | null
  overdue: boolean
  note: string
  requestId: string | null
  by: string | null
  returns: { index: number; at: string; by: string | null; items: { name: string; qty: number }[]; note: string; undone: boolean; undoReason: string | null }[]
  closedAt: string | null
  writeOffReason: string | null
  edits: { at: string; by: string | null; why: string; summary: string }[]
  requestNo?: string | null
}

export async function listLoans(f: { status?: string; direction?: string; partner?: string } = {}, limit = 300): Promise<LoanRow[]> {
  const q: Record<string, unknown> = {}
  if (f.direction === 'TAKEN' || f.direction === 'GIVEN') q.direction = f.direction
  if (f.status === 'open') q.status = { $in: ['OPEN', 'PARTLY_RETURNED'] }
  else if (f.status === 'overdue') Object.assign(q, { status: { $in: ['OPEN', 'PARTLY_RETURNED'] }, dueAt: { $lt: new Date() } })
  else if (f.status === 'closed') q.status = { $in: ['RETURNED', 'WRITTEN_OFF'] }
  if (f.partner) q['partner.name'] = f.partner
  const rows = await StoreLoan.find(q).sort({ at: -1 }).limit(limit).lean<any[]>()
  const users = await User.find({ _id: { $in: [...new Set(rows.flatMap((r) => [r.by, ...(r.returns ?? []).map((x: any) => x.by), ...(r.edits ?? []).map((x: any) => x.by)]).filter(Boolean).map(String))] } }).select('name').lean<any[]>()
  const reqs = await HomecareRequest.find({ _id: { $in: rows.map((r) => r.requestId).filter(Boolean) } }).select('requestNo').lean<any[]>()
  const nameOf = (id: unknown) => users.find((u) => String(u._id) === String(id))?.name ?? null
  const now = Date.now()
  return rows.map((r) => {
    const open = r.status === 'OPEN' || r.status === 'PARTLY_RETURNED'
    return {
      id: String(r._id),
      no: r.no,
      direction: r.direction,
      partner: { kind: r.partner?.kind, name: r.partner?.name, phone: r.partner?.phone ?? null },
      items: r.items.map((i: any) => ({ itemId: String(i.itemId), name: i.name, unit: i.unit, qty: i.qty, returnedQty: i.returnedQty ?? 0, outstanding: outstanding(i) })),
      status: r.status,
      at: new Date(r.at).toISOString(),
      dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
      overdue: open && !!r.dueAt && new Date(r.dueAt).getTime() < now,
      note: r.note ?? '',
      requestId: r.requestId ? String(r.requestId) : null,
      by: nameOf(r.by),
      returns: (r.returns ?? []).map((x: any, index: number) => ({ index, at: new Date(x.at).toISOString(), by: nameOf(x.by), items: x.items.map((y: any) => ({ name: r.items.find((i: any) => String(i.itemId) === String(y.itemId))?.name ?? 'Item', qty: y.qty })), note: x.note ?? '', undone: !!x.undoneAt, undoReason: x.undoReason ?? null })),
      closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
      writeOffReason: r.writeOffReason ?? null,
      edits: (r.edits ?? []).map((e: any) => ({
        at: new Date(e.at).toISOString(),
        by: nameOf(e.by),
        why: e.why ?? '',
        summary: e.before?.items && e.after?.items ? `${(e.before.items ?? []).map((i: any) => `${i.name} × ${i.qty}`).join(', ')} → ${(e.after.items ?? []).map((i: any) => `${i.name} × ${i.qty}`).join(', ')}${e.before.partner?.name && e.before.partner.name !== e.after.partner?.name ? ` · ${e.before.partner.name} → ${e.after.partner?.name}` : ''}` : `${e.before?.status ?? ''} → ${e.after?.status ?? ''}`,
      })),
      requestNo: reqs.find((q) => String(q._id) === String(r.requestId))?.requestNo ?? null,
    }
  })
}

/** Per partner: what we owe them (borrowed, not given back) and what they owe us (lent, not returned). */
export async function loanBalances() {
  const open = await StoreLoan.find({ status: { $in: ['OPEN', 'PARTLY_RETURNED'] } }).lean<any[]>()
  const map = new Map<string, { partner: string; kind: string; weOwe: Map<string, number>; theyOwe: Map<string, number>; overdue: number; loans: number }>()
  for (const l of open) {
    const k = l.partner.name
    if (!map.has(k)) map.set(k, { partner: k, kind: l.partner.kind, weOwe: new Map(), theyOwe: new Map(), overdue: 0, loans: 0 })
    const b = map.get(k)!
    b.loans++
    if (l.dueAt && new Date(l.dueAt) < new Date()) b.overdue++
    for (const i of l.items) {
      const o = outstanding(i)
      if (!o) continue
      const m = l.direction === 'TAKEN' ? b.weOwe : b.theyOwe
      m.set(`${i.name} (${i.unit})`, (m.get(`${i.name} (${i.unit})`) ?? 0) + o)
    }
  }
  return [...map.values()].map((b) => ({ partner: b.partner, kind: b.kind, loans: b.loans, overdue: b.overdue, weOwe: [...b.weOwe.entries()].map(([name, qty]) => ({ name, qty })), theyOwe: [...b.theyOwe.entries()].map(([name, qty]) => ({ name, qty })) }))
}

/** Names used before (for the typed partner field). */
export async function loanPartners() {
  const rows = await StoreLoan.aggregate([{ $group: { _id: { name: '$partner.name', kind: '$partner.kind' }, phone: { $last: '$partner.phone' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 100 }])
  return rows.map((r) => ({ name: r._id.name as string, kind: r._id.kind as string, phone: (r.phone as string) ?? null }))
}

/** Per item: how many are lent out / borrowed right now (for the store cards). */
export async function loansByItem() {
  const open = await StoreLoan.find({ status: { $in: ['OPEN', 'PARTLY_RETURNED'] } }).select('direction items').lean<any[]>()
  const out = new Map<string, { lentOut: number; borrowed: number }>()
  for (const l of open)
    for (const i of l.items) {
      const o = outstanding(i)
      if (!o) continue
      const cur = out.get(String(i.itemId)) ?? { lentOut: 0, borrowed: 0 }
      if (l.direction === 'GIVEN') cur.lentOut += o
      else cur.borrowed += o
      out.set(String(i.itemId), cur)
    }
  return out
}

/** Sweep: once a day per overdue loan, remind the store managers. */
export async function remindOverdueLoans() {
  const dayAgo = new Date(Date.now() - 20 * 3600_000)
  const due = await StoreLoan.find({ status: { $in: ['OPEN', 'PARTLY_RETURNED'] }, dueAt: { $lt: new Date() }, $or: [{ remindedAt: null }, { remindedAt: { $lt: dayAgo } }] }).limit(20).lean<any[]>()
  for (const l of due) {
    const claimed = await StoreLoan.updateOne({ _id: l._id, $or: [{ remindedAt: null }, { remindedAt: { $lt: dayAgo } }] }, { $set: { remindedAt: new Date() } })
    if (!claimed.modifiedCount) continue
    const what = l.items.filter((i: any) => outstanding(i)).map((i: any) => `${i.name} × ${outstanding(i)}`).join(', ')
    await notifyRoles(['HC_ADMIN', 'SUPER_ADMIN'], {
      type: 'SYSTEM',
      title: `Loan overdue · ${l.direction === 'GIVEN' ? `${l.partner.name} has to return` : `we have to give back to ${l.partner.name}`}`,
      body: `${l.no} · ${what} · due ${new Date(l.dueAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })}`,
      url: '/store?tab=loans',
      priority: 'high',
    })
  }
  return due.length
}
