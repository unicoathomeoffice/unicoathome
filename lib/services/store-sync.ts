import 'server-only'
import { z } from 'zod'
import { Equipment, HomecareRequest, Setting, StockMove, StoreConsumption, StoreIssue, StoreSnapshot, User } from '../models'
import { audit, type Meta } from '../audit'
import { bad, notFound } from '../api'
import { notifyRoles } from '../messaging'
import { fetchItemTransactions, fetchSubStoreStock, type H360StockRow } from '../h360-store'
import { parseItemName } from '../store-groups'
import { moveStock } from './stock'
import type { SessionUser } from '../auth'

// The HomeCare store (Family Medicine) matched against H360's Sub Store Stock Ledger, item by item. H360 is only read.
//
// Both stores agreed at the item's sync point (h360SyncedAt / h360LastStock — at first the opening import). Since then:
//   HomeCare = S + received here − used here (visits + by hand) + counts
//   H360     = S + received in H360 − consumed in H360                   (from H360's per-item transactions)
// so a difference splits into: used here but not yet consumed in H360 (staff must enter it in H360), consumed in H360
// but not here, received on one side only, stock counts here — and whatever is left is unexplained.

type Actor = Pick<SessionUser, 'id' | 'name' | 'role'> | null
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

export type Kind = 'MATCH' | 'TO_CONSUME' | 'H360_LOWER' | 'H360_HIGHER' | 'ONLY_H360' | 'ONLY_LOCAL'
export type Usage = { at: string; qty: number; what: string; requestId: string | null; requestNo: string | null; patient: string | null; ref: string | null }
export type H360Move = { at: string; type: string; ref: string; qty: number }
export type CompareRow = {
  key: string
  itemId: string | null
  code: string | null
  name: string
  family: string | null
  variant: string | null
  brand: string | null
  unit: string
  type: string | null
  h360: number | null
  local: number | null
  diff: number // HomeCare − H360
  price: number // H360 purchase price
  value: number // ৳ |diff| × price
  kind: Kind
  tolerance: number
  syncedAt: string | null
  // breakdown since the sync point
  usedHere: number
  receivedHere: number
  countedHere: number
  loansHere: number // + borrowed / lent items returned · − lent / borrowed items given back
  outH360: number | null // null = H360 history not read
  inH360: number | null
  toConsume: number // used here, not yet consumed in H360 → enter in H360 Department Consumption
  consumedOnlyInH360: number
  receivedOnlyInH360: number
  unexplained: number | null
  usage: Usage[] // what makes up "used here"
  h360Moves: H360Move[]
  issue: { id: string; status: string; since: string; assignedTo: string | null; acceptedReason: string | null; acceptedUntil: string | null; note: string | null } | null
}
export type Compare = { at: string; storeName: string; h360Total: number; localTotal: number; rows: CompareRow[]; counts: Record<Kind, number> & { unexplained: number; value: number; differences: number } }

/** dd/mm/yyyy + hh:mm:ss am → Date (Dhaka) */
function h360Date(d: string, t: string) {
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  const tm = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i)
  let h = tm ? Number(tm[1]) : 12
  if (tm?.[4]) h = (h % 12) + (tm[4].toLowerCase() === 'pm' ? 12 : 0)
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${String(h).padStart(2, '0')}:${tm?.[2] ?? '00'}:${tm?.[3] ?? '00'}+06:00`
  const out = new Date(iso)
  return Number.isNaN(out.getTime()) ? null : out
}

/** H360's per-item history since `since`: inward (receive / return) and outward (consumption / issue / transfer). */
async function h360Since(row: H360StockRow, since: Date): Promise<{ in: number; out: number; moves: H360Move[] } | null> {
  try {
    const t = await fetchItemTransactions(row)
    const col = (name: RegExp) => t.headers.findIndex((h) => name.test(h))
    const iDate = col(/^date$/i)
    const iTime = col(/^time$/i)
    const iType = col(/type/i)
    const iRef = col(/reference/i)
    const iQty = col(/transaction qty|qty/i)
    const iPos = col(/stock position|balance/i)
    let prev: number | null = null
    let inn = 0
    let out = 0
    const moves: H360Move[] = []
    for (const r of t.rows) {
      const pos = iPos >= 0 ? Number(String(r[iPos]).replace(/,/g, '')) : NaN
      const qty = Math.abs(Number(String(r[iQty] ?? '').replace(/,/g, '')) || 0)
      const type = r[iType] ?? ''
      // direction from the running balance when H360 shows it, else from the transaction type
      const sign = Number.isFinite(pos) && prev != null ? Math.sign(pos - prev) : /receive|return|opening|purchase/i.test(type) ? 1 : -1
      if (Number.isFinite(pos)) prev = pos
      const at = h360Date(r[iDate] ?? '', r[iTime] ?? '')
      if (!at || at <= since || !qty) continue
      if (sign >= 0) inn += qty
      else out += qty
      moves.push({ at: at.toISOString(), type: type.replace(/\s*\(.*\)\s*$/, '').replace(/SRTORE/g, 'STORE'), ref: r[iRef] ?? '', qty: sign >= 0 ? qty : -qty })
    }
    return { in: inn, out, moves }
  } catch {
    return null
  }
}

/** Run the comparison. `deep`: read H360's history for each difference (explains it; slower). */
export async function compareWithH360(opts: { fresh?: boolean; deep?: boolean } = {}): Promise<Compare> {
  const h = await fetchSubStoreStock({ fresh: opts.fresh })
  const local = await Equipment.find({}).select('name unit type stock family variant brand h360Code h360SyncedAt h360LastStock tolerance isActive notes').lean<any[]>()
  // backfill codes from the import note once ("H360 26899745 · …")
  for (const l of local)
    if (!l.h360Code) {
      const code = String(l.notes ?? '').match(/^H360 (\S+) /)?.[1]
      if (code) {
        l.h360Code = code
        await Equipment.updateOne({ _id: l._id, h360Code: { $in: [null, ''] } }, { $set: { h360Code: code } })
      }
    }
  const byCode = new Map(h.items.map((r) => [r.code, r]))
  const usedCodes = new Set<string>()
  const pairs: { l: any | null; r: H360StockRow | null }[] = []
  for (const l of local) {
    let r = l.h360Code ? byCode.get(l.h360Code) : undefined
    if (!r) r = h.items.find((x) => !usedCodes.has(x.code) && norm(x.name) === norm(l.name)) // same name, code not set
    if (r) usedCodes.add(r.code)
    if (r || l.isActive !== false) pairs.push({ l, r: r ?? null })
  }
  for (const r of h.items) if (!usedCodes.has(r.code)) pairs.push({ l: null, r })

  // the sync point of each item: last match, else the opening import
  const ids = pairs.filter((p) => p.l).map((p) => p.l._id)
  const [moves, openings] = await Promise.all([
    StockMove.find({ itemId: { $in: ids } }).select('itemId delta reason at requestId consumptionId note').lean<any[]>(),
    StockMove.find({ itemId: { $in: ids }, reason: 'OPENING' }).select('itemId delta at').lean<any[]>(),
  ])
  const voided = new Set((await StoreConsumption.find({ voidedAt: { $ne: null } }).select('_id').lean<any[]>()).map((c) => String(c._id)))
  const reqIds = [...new Set(moves.map((m) => String(m.requestId ?? '')).filter(Boolean))]
  const reqs = reqIds.length ? await HomecareRequest.find({ _id: { $in: reqIds } }).select('requestNo patientSnapshot.name').lean<any[]>() : []
  const cons = await StoreConsumption.find({ _id: { $in: moves.map((m) => m.consumptionId).filter(Boolean) } }).select('no reason').lean<any[]>()
  const issues = await StoreIssue.find({ status: { $ne: 'RESOLVED' } }).lean<any[]>()
  const issueUsers = await User.find({ _id: { $in: issues.map((i) => i.assignedTo).filter(Boolean) } }).select('name').lean<any[]>()

  const sinceOf = (l: any): Date | null => {
    const opening = openings.find((o) => String(o.itemId) === String(l._id))
    return l.h360SyncedAt ? new Date(l.h360SyncedAt) : opening ? new Date(opening.at) : null
  }
  // H360's history for the items that differ (max 40 per run, 6 at a time) — explains each difference
  const history = new Map<string, Awaited<ReturnType<typeof h360Since>>>()
  if (opts.deep ?? true) {
    const todo = pairs.filter((p) => p.l && p.r && Math.abs((p.l.stock ?? 0) - p.r.stock) > (p.l.tolerance ?? 0) && sinceOf(p.l)).slice(0, 40)
    for (let i = 0; i < todo.length; i += 6)
      await Promise.all(todo.slice(i, i + 6).map(async (p) => history.set(String(p.l._id), await h360Since(p.r!, sinceOf(p.l)!))))
  }

  const rows: CompareRow[] = []
  for (const { l, r } of pairs) {
    const id = l ? String(l._id) : null
    const since: Date | null = l ? sinceOf(l) : null
    const mine = l ? moves.filter((m) => String(m.itemId) === id && (!since || m.at > since) && m.reason !== 'OPENING') : []
    let usedHere = 0
    let receivedHere = 0
    let countedHere = 0
    let loansHere = 0
    const usage: Usage[] = []
    for (const m of mine) {
      if (m.reason === 'VISIT' || (m.reason === 'MANUAL' && !voided.has(String(m.consumptionId)))) {
        usedHere -= m.delta
        const q = reqs.find((x) => String(x._id) === String(m.requestId))
        const c = cons.find((x) => String(x._id) === String(m.consumptionId))
        usage.push({ at: new Date(m.at).toISOString(), qty: -m.delta, what: m.reason === 'VISIT' ? 'Visit' : 'By hand', requestId: q ? String(q._id) : null, requestNo: q?.requestNo ?? null, patient: q?.patientSnapshot?.name ?? null, ref: c?.no ?? null })
      } else if (String(m.reason).startsWith('LOAN_')) loansHere += m.delta
      else if (m.reason === 'RECEIVED') receivedHere += m.delta
      else if (m.reason === 'ADJUST' && !(m.consumptionId && voided.has(String(m.consumptionId)))) countedHere += m.delta
      else if (m.reason === 'MANUAL' && voided.has(String(m.consumptionId))) {
        /* voided by hand: the ADJUST back cancels it */
      }
    }
    const hq = r ? r.stock : null
    const lq = l ? l.stock ?? 0 : null
    const diff = (lq ?? 0) - (hq ?? 0)
    const tol = l?.tolerance ?? 0
    let kind: Kind = !l ? 'ONLY_H360' : !r ? 'ONLY_LOCAL' : Math.abs(diff) <= tol ? 'MATCH' : 'H360_LOWER'
    let outH360: number | null = null
    let inH360: number | null = null
    let h360Moves: H360Move[] = []
    if (kind !== 'MATCH' && id && history.get(id)) {
      const hs = history.get(id)
      if (hs) {
        outH360 = hs.out
        inH360 = hs.in
        h360Moves = hs.moves
      }
    }
    const toConsume = Math.max(0, usedHere - (outH360 ?? 0))
    const consumedOnlyInH360 = outH360 == null ? 0 : Math.max(0, outH360 - usedHere)
    const receivedOnlyInH360 = inH360 == null ? 0 : Math.max(0, inH360 - receivedHere)
    // what the known moves explain of the difference; the rest is unexplained
    const explained = outH360 == null ? null : receivedHere - (inH360 ?? 0) - (usedHere - outH360) + countedHere + loansHere
    const unexplained = kind === 'MATCH' || !l || !r ? 0 : explained == null ? null : diff - explained
    // HomeCare lower than H360: usually used here and not yet consumed in H360 (TO_CONSUME); else H360 has more
    if (kind === 'H360_LOWER' && diff < 0) kind = toConsume > 0 ? 'TO_CONSUME' : 'H360_HIGHER'
    const price = r?.purchasePrice ?? 0
    const issue = issues.find((i) => (id && String(i.itemId) === id) || (!id && r && i.code === r.code))
    rows.push({
      key: id ?? `h360:${r!.code}`,
      itemId: id,
      code: r?.code ?? l?.h360Code ?? null,
      name: l?.name ?? r!.name,
      family: l?.family ?? (r ? parseItemName(r.name).family || null : null),
      variant: l?.variant ?? null,
      brand: l?.brand ?? null,
      unit: l?.unit ?? r?.uom ?? 'pcs',
      type: l?.type ?? null,
      h360: hq,
      local: lq,
      diff: !l || !r ? (lq ?? 0) - (hq ?? 0) : diff,
      price,
      value: Math.round(Math.abs(!l || !r ? (hq ?? lq ?? 0) : diff) * price * 100) / 100,
      kind,
      tolerance: tol,
      syncedAt: since ? since.toISOString() : null,
      usedHere,
      receivedHere,
      countedHere,
      loansHere,
      outH360,
      inH360,
      toConsume,
      consumedOnlyInH360,
      receivedOnlyInH360,
      unexplained,
      usage: usage.sort((a, b) => a.at.localeCompare(b.at)),
      h360Moves,
      issue: issue
        ? {
            id: String(issue._id),
            status: issue.status,
            since: new Date(issue.since).toISOString(),
            assignedTo: issueUsers.find((u) => String(u._id) === String(issue.assignedTo))?.name ?? null,
            acceptedReason: issue.acceptedReason ?? null,
            acceptedUntil: issue.acceptedUntil ? new Date(issue.acceptedUntil).toISOString() : null,
            note: issue.log?.length ? issue.log[issue.log.length - 1].text : null,
          }
        : null,
    })
  }
  const counts = { MATCH: 0, TO_CONSUME: 0, H360_LOWER: 0, H360_HIGHER: 0, ONLY_H360: 0, ONLY_LOCAL: 0, unexplained: 0, value: 0, differences: 0 }
  for (const x of rows) {
    counts[x.kind]++
    if (x.kind !== 'MATCH') {
      counts.differences++
      counts.value += x.value
      if (x.unexplained) counts.unexplained++
    }
  }
  counts.value = Math.round(counts.value)
  return { at: new Date().toISOString(), storeName: h.storeName, h360Total: h.totalQty, localTotal: local.filter((l) => l.isActive !== false).reduce((a, l) => a + Math.max(0, l.stock ?? 0), 0), rows, counts }
}

/** Keep the follow-up list in step with a comparison: open issues for new differences, close those that now match. */
async function trackIssues(c: Compare) {
  const open = await StoreIssue.find({ status: { $ne: 'RESOLVED' } }).lean<any[]>()
  let fresh = 0
  for (const row of c.rows) {
    const issue = open.find((i) => (row.itemId && String(i.itemId) === row.itemId) || (!row.itemId && i.code === row.code))
    if (row.kind === 'MATCH') {
      if (issue) await StoreIssue.updateOne({ _id: issue._id }, { $set: { status: 'RESOLVED', resolvedHow: 'matched', resolvedAt: new Date() }, $push: { log: { at: new Date(), byName: 'System', text: 'Matches H360 now' } } })
      continue
    }
    if (issue) {
      const expired = issue.status === 'ACCEPTED' && issue.acceptedUntil && new Date(issue.acceptedUntil) < new Date()
      await StoreIssue.updateOne({ _id: issue._id }, { $set: { kind: row.kind, lastDiff: row.diff, lastValue: row.value, ...(expired ? { status: 'OPEN' } : {}) }, ...(expired ? { $push: { log: { at: new Date(), byName: 'System', text: 'Accepted period ended — open again' } } } : {}) })
    } else {
      fresh++
      await StoreIssue.create({ itemId: row.itemId ?? undefined, code: row.code ?? undefined, name: row.name, kind: row.kind, lastDiff: row.diff, lastValue: row.value, log: [{ at: new Date(), byName: 'System', text: `Found: HomeCare ${row.local ?? '—'} vs H360 ${row.h360 ?? '—'}` }] })
    }
  }
  return fresh
}

/** Compare, remember the result (snapshot + follow-up list), alert admins about new differences. */
export async function runCompare(user: Actor, opts: { background?: boolean } = {}) {
  const c = await compareWithH360({ fresh: true, deep: true })
  const fresh = await trackIssues(c)
  await StoreSnapshot.create({ h360Total: c.h360Total, localTotal: c.localTotal, items: c.rows.length, matched: c.counts.MATCH, differences: c.counts.differences, toConsume: c.counts.TO_CONSUME, unexplained: c.counts.unexplained, value: c.counts.value, by: user?.id })
  await Setting.updateOne({ key: 'store:lastCompare' }, { value: { at: new Date(), differences: c.counts.differences, unexplained: c.counts.unexplained, value: c.counts.value } }, { upsert: true })
  if (fresh > 0)
    await notifyRoles(['HC_ADMIN', 'SUPER_ADMIN'], {
      type: 'SYSTEM',
      title: `Store vs H360: ${fresh} new difference${fresh === 1 ? '' : 's'}`,
      body: `${c.counts.differences} in all · ৳${c.counts.value.toLocaleString('en-US')} out of balance${c.counts.TO_CONSUME ? ` · ${c.counts.TO_CONSUME} to consume in H360` : ''}`,
      url: '/store?tab=h360',
    })
  if (!opts.background && user) await audit(user, 'store.compare', 'store', 'h360', { after: { differences: c.counts.differences, unexplained: c.counts.unexplained, value: c.counts.value, newIssues: fresh } })
  return c
}

/** Sweep: compare at most every 30 minutes (only when a login for H360 is saved). */
export async function compareIfDue() {
  const last = await Setting.findOne({ key: 'store:lastCompare' }).lean<any>()
  if (last?.value?.at && Date.now() - new Date(last.value.at).getTime() < 30 * 60_000) return null
  // claim this run so two sweeps at once don't both compare
  const claim = await Setting.updateOne({ key: 'store:lastCompare', 'value.at': last?.value?.at ?? null }, { $set: { 'value.at': new Date() } }, { upsert: !last })
  if (!claim.modifiedCount && !claim.upsertedCount) return null
  return runCompare(null, { background: true }).catch((e) => (console.error('[store compare]', e?.message ?? e), null))
}

// ---------------------------------------------------------------- actions
export const ActionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('match'), itemIds: z.array(z.string()).min(1).max(200), note: z.string().max(200).optional() }),
  z.object({ action: z.literal('consumed'), itemIds: z.array(z.string()).min(1).max(200) }),
  z.object({ action: z.literal('received'), itemIds: z.array(z.string()).min(1).max(200) }),
  z.object({ action: z.literal('add'), codes: z.array(z.string()).min(1).max(200) }),
  z.object({ action: z.literal('link'), itemId: z.string(), code: z.string().trim().min(1).max(30) }),
  z.object({ action: z.literal('accept'), itemId: z.string().optional(), code: z.string().optional(), reason: z.string().trim().min(3).max(200), days: z.coerce.number().int().min(1).max(90) }),
  z.object({ action: z.literal('assign'), itemId: z.string().optional(), code: z.string().optional(), userId: z.string().optional(), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('reopen'), itemId: z.string().optional(), code: z.string().optional() }),
  z.object({ action: z.literal('tolerance'), itemId: z.string(), value: z.coerce.number().int().min(0).max(1000) }),
])

async function setSync(itemId: unknown, h360Stock: number) {
  await Equipment.updateOne({ _id: itemId }, { $set: { h360SyncedAt: new Date(), h360LastStock: h360Stock } })
}
async function resolve(itemId: unknown, how: string, user: SessionUser) {
  await StoreIssue.updateMany({ itemId, status: { $ne: 'RESOLVED' } }, { $set: { status: 'RESOLVED', resolvedHow: how, resolvedAt: new Date(), resolvedBy: user.id }, $push: { log: { at: new Date(), by: user.id, byName: user.name, text: `Resolved — ${how}` } } })
}
async function issueFor(input: { itemId?: string; code?: string }) {
  const issue = await StoreIssue.findOne({ status: { $ne: 'RESOLVED' }, ...(input.itemId ? { itemId: input.itemId } : { code: input.code }) })
  if (!issue) throw notFound('Open difference')
  return issue
}

export async function storeAction(input: z.infer<typeof ActionInput>, user: SessionUser, meta: Meta = {}) {
  if (input.action === 'tolerance') {
    await Equipment.updateOne({ _id: input.itemId }, { $set: { tolerance: input.value } })
    await audit(user, 'equipment.update', 'equipment', input.itemId, { after: { tolerance: input.value } }, meta)
    return { ok: true }
  }
  if (input.action === 'link') {
    const h = await fetchSubStoreStock({ fresh: true })
    const r = h.items.find((x) => x.code === input.code)
    if (!r) throw bad(`H360 code ${input.code} is not in the Family Medicine store`)
    await Equipment.updateOne({ _id: input.itemId }, { $set: { h360Code: r.code } })
    await audit(user, 'equipment.update', 'equipment', input.itemId, { after: { h360Code: r.code, h360Name: r.name } }, meta)
    return { ok: true }
  }
  if (input.action === 'accept' || input.action === 'assign' || input.action === 'reopen') {
    const issue = await issueFor(input)
    if (input.action === 'accept') {
      issue.status = 'ACCEPTED'
      issue.acceptedReason = input.reason
      issue.acceptedUntil = new Date(Date.now() + input.days * 86400_000)
      issue.log.push({ at: new Date(), by: user.id, byName: user.name, text: `Accepted for ${input.days} days — ${input.reason}` })
    } else if (input.action === 'assign') {
      issue.status = 'IN_PROGRESS'
      if (input.userId) issue.assignedTo = input.userId
      const who = input.userId ? (await User.findById(input.userId).select('name').lean<any>())?.name : null
      issue.log.push({ at: new Date(), by: user.id, byName: user.name, text: [who ? `Given to ${who}` : 'In progress', input.note].filter(Boolean).join(' — ') })
    } else {
      issue.status = 'OPEN'
      issue.acceptedUntil = undefined
      issue.log.push({ at: new Date(), by: user.id, byName: user.name, text: 'Opened again' })
    }
    await issue.save()
    await audit(user, `store.issue_${input.action}`, 'store', issue._id, { after: { name: issue.name, status: issue.status, ...(input.action === 'accept' ? { reason: input.reason, days: input.days } : {}) }, label: issue.name }, meta)
    return { ok: true }
  }

  const h = await fetchSubStoreStock({ fresh: true })
  if (input.action === 'add') {
    const added: string[] = []
    for (const code of input.codes) {
      const r = h.items.find((x) => x.code === code)
      if (!r || (await Equipment.exists({ h360Code: code }))) continue
      const p = parseItemName(r.name)
      const e = await Equipment.create({ name: r.name, unit: r.uom || 'pcs', type: 'CONSUMABLE', h360Code: code, family: p.family || undefined, variant: p.variant || undefined, brand: p.brand || undefined, notes: `H360 ${code} · added from the Family Medicine store`, isActive: true, sortOrder: 900, createdBy: user.id })
      if (r.stock) await moveStock(e._id, r.stock, 'OPENING', { note: 'Added from H360 Sub Store Stock Ledger', by: user.id })
      await setSync(e._id, r.stock)
      await StoreIssue.updateMany({ code, status: { $ne: 'RESOLVED' } }, { $set: { status: 'RESOLVED', resolvedHow: 'added', resolvedAt: new Date(), resolvedBy: user.id, itemId: e._id } })
      await audit(user, 'equipment.create', 'equipment', e._id, { after: { name: r.name, h360Code: code, stock: r.stock, from: 'H360' }, label: r.name }, meta)
      added.push(r.name)
    }
    return { ok: true, added }
  }

  const items = await Equipment.find({ _id: { $in: input.itemIds } }).select('name stock h360Code unit').lean<any[]>()
  const done: string[] = []
  const still: string[] = []
  for (const it of items) {
    const r = it.h360Code ? h.items.find((x) => x.code === it.h360Code) : null
    if (!r) {
      still.push(`${it.name} (not in H360)`)
      continue
    }
    const local = it.stock ?? 0
    if (input.action === 'match') {
      if (r.stock !== local) await moveStock(it._id, r.stock - local, 'ADJUST', { note: input.note || 'Matched to H360 stock ledger', by: user.id })
      await setSync(it._id, r.stock)
      await resolve(it._id, 'matched to H360', user)
      done.push(it.name)
    } else if (input.action === 'consumed') {
      // staff entered our usage in H360's Department Consumption: both sides must now agree
      if (r.stock === local) {
        await setSync(it._id, r.stock)
        await resolve(it._id, 'consumed in H360', user)
        done.push(it.name)
      } else still.push(`${it.name}: H360 ${r.stock} vs HomeCare ${local}`)
    } else if (input.action === 'received') {
      if (r.stock > local) {
        await moveStock(it._id, r.stock - local, 'RECEIVED', { note: 'Received per H360 stock ledger', by: user.id })
        await setSync(it._id, r.stock)
        await resolve(it._id, 'received per H360', user)
        done.push(it.name)
      } else still.push(`${it.name}: H360 is not higher`)
    }
  }
  if (done.length) await audit(user, `store.${input.action}`, 'store', 'h360', { after: { items: done } }, meta)
  return { ok: true, done, still }
}

/** Last 30 days of comparisons (one point per day: the latest that day). */
export async function compareTrend() {
  const rows = await StoreSnapshot.find({ at: { $gte: new Date(Date.now() - 30 * 86400_000) } }).sort({ at: 1 }).select('at differences unexplained value toConsume').lean<any[]>()
  const byDay = new Map<string, any>()
  for (const r of rows) byDay.set(new Date(r.at).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }), r)
  return [...byDay.entries()].map(([day, r]) => ({ day, differences: r.differences ?? 0, unexplained: r.unexplained ?? 0, value: r.value ?? 0, toConsume: r.toConsume ?? 0 }))
}
