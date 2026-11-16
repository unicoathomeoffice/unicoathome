import 'server-only'
import { z } from 'zod'
import { audit } from '../audit'
import { requestTests } from '../visit-details'
import type { SessionUser } from '../auth'

type Meta = Parameters<typeof audit>[5]

// words that say nothing about which test or service a bill line is
const STOP = new Set(['home', 'unico', 'at', 'the', 'of', 'and', 'for', 'selected', 'areas', 'area', 'service', 'services', 'charge', 'charges', 'fee', 'fees', 'visit', 'test', 'with', 'in'])
const norm = (s?: string | null) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (s?: string | null) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w))

/** The same test or service, written two ways ("S. Creatinine" / "Creatinine", "Home Lab Sample Collection" / "Sample collection"). */
export function sameItem(a?: string | null, b?: string | null) {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb || na.includes(nb) || nb.includes(na)) return true
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return false
  const common = wa.filter((w) => wb.includes(w)).length
  return common / Math.min(wa.length, wb.length) >= 0.75
}

export type BillLine = { name: string; rate?: number; amount?: number; invoiceNo?: string }

/**
 * Bill against request: lines on the invoices (H360 or uploaded) that the request does not have, and tests on the
 * request that no invoice line covers. Replaced bills are left out.
 */
export function billMatch(r: any) {
  const lines: BillLine[] = (r.billing?.invoices ?? [])
    .filter((i: any) => !i.replacedBy)
    .flatMap((i: any) => (i.items ?? []).map((it: any) => ({ name: String(it.name ?? '').trim(), rate: it.rate ?? undefined, amount: it.amount ?? undefined, invoiceNo: i.invoiceNo })))
    .filter((l: BillLine) => l.name)
  const tests = requestTests(r)
  const services = (r.services ?? []).map((s: any) => s.name).filter(Boolean) as string[]
  const known = [...tests, ...services]
  const seen = new Set<string>()
  const billedOnly = lines.filter((l) => {
    const k = norm(l.name)
    if (seen.has(k) || known.some((n) => sameItem(n, l.name))) return false
    seen.add(k)
    return true
  })
  const requestedOnly = lines.length ? tests.filter((t) => !lines.some((l) => sameItem(t, l.name))) : []
  return { lines: lines.length, billedOnly, requestedOnly, ok: !billedOnly.length && !requestedOnly.length }
}

export const BillMatchInput = z.object({ add: z.array(z.string()).max(60).default([]), remove: z.array(z.string()).max(60).default([]) })

/**
 * Make the request match the bill: billed lines are added as tests (with the bill's rate), tests nobody billed are
 * taken off. The WhatsApp messages still waiting for this request are rewritten with the new list.
 */
export async function applyBillMatch(r: any, input: z.infer<typeof BillMatchInput>, user: SessionUser, meta: Meta = {}) {
  const m = billMatch(r)
  const add = m.billedOnly.filter((l) => input.add.includes(l.name))
  const remove = m.requestedOnly.filter((t) => input.remove.includes(t))
  if (!add.length && !remove.length) return { ok: true, added: [], removed: [], refreshed: 0, match: m }
  const off = (n?: string | null) => remove.some((x) => x === n)
  const testItems = [...(r.testItems ?? []).map((t: any) => (t.toObject ? t.toObject() : t)), ...add.map((l) => ({ code: '', name: l.name, price: l.rate ?? l.amount ?? 0 }))].filter((t: any) => !off(t.name))
  const tests = [...new Set([...(r.tests ?? []), ...add.map((l) => l.name)])].filter((t) => !off(t))
  r.set({ testItems, tests })
  await r.save()
  await audit(user, 'request.bill_match', 'request', r._id, { after: { added: add.map((l) => l.name), removed: remove }, label: r.requestNo }, meta)
  const { refreshPending } = await import('../wa/outbox')
  const refreshed = await refreshPending({ requestId: r._id }).catch(() => 0)
  return { ok: true, added: add.map((l) => l.name), removed: remove, refreshed, match: billMatch(r) }
}
