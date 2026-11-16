import 'server-only'
import { Patient, ServiceType } from '../models'
import { H360Error } from '../h360'
import { h360ItemByCode, searchH360Items } from '../h360-items'
import { h360BillingOf } from '../h360-patient'

// Live bill: what this visit should cost, priced the way H360's billing does it for this patient. Prices and discounts
// come from H360 itself (searched with the patient's corporate, found by UHID) — e.g. "Unico senior citizens care" gets
// 40% on lab tests while home care service charges stay at full price, because H360 says so per item. Nothing is
// hard-coded and nothing is written to H360. Compared with the H360 bill(s) already on the visit.

export type LiveLine = {
  kind: 'service' | 'test'
  code?: string
  name: string
  rate: number
  discountPct: number
  discount: number
  net: number
  /** H360 = price and discount from H360 now · SAVED = the price saved on the request (H360 did not answer for it) ·
   *  HOMECARE = the HomeCare service fee (no H360 item linked) · NONE = no price known */
  source: 'H360' | 'SAVED' | 'HOMECARE' | 'NONE'
}

export type LiveBill = {
  uhid: string | null
  /** registered in H360 (found by UHID) */
  registered: boolean
  corporate?: string
  patientType?: string
  lines: LiveLine[]
  gross: number
  discount: number
  net: number
  /** the H360 bills already on this visit (re-billed ones left out) */
  billed: { count: number; total: number; discount: number; payable: number } | null
  /** billed payable − live net (0 = matches) */
  diff: number | null
  /** every line of the H360 bill(s) on the visit, checked against the discount H360 gives this patient on that item */
  checks: BillCheck[]
  offline?: string
}

export type BillCheck = {
  invoiceNo: string
  name: string
  rate: number
  /** discount on the bill */
  discount: number
  /** the discount H360 gives this patient on the item now (null = item not found in the catalog by name) */
  expectedPct: number | null
  expected: number | null
  /** OK · LOW (less discount than due) · HIGH (more than due) · UNKNOWN */
  status: 'OK' | 'LOW' | 'HIGH' | 'UNKNOWN'
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const line = (kind: LiveLine['kind'], name: string, rate: number, pct: number, source: LiveLine['source'], code?: string): LiveLine => {
  const discount = Math.round((rate * pct) / 100)
  return { kind, code, name, rate, discountPct: pct, discount, net: rate - discount, source }
}

export async function liveBill(r: any): Promise<LiveBill> {
  let uhid: string | null = r.patientSnapshot?.uhid || null
  if (!uhid && r.patientId) uhid = (await Patient.findById(r.patientId).select('uhid').lean<any>())?.uhid || null
  let offline: string | undefined
  const reg = uhid
    ? await h360BillingOf(uhid).catch((e) => {
        offline = e instanceof H360Error ? e.message : 'H360 did not answer'
        return null
      })
    : null
  const corp = reg?.corporateId
  const price = async (code: string) => {
    try {
      return await h360ItemByCode(code, corp)
    } catch (e) {
      offline ??= e instanceof H360Error ? e.message : 'H360 did not answer'
      return null
    }
  }

  // home care service charges: the H360 item linked to the service (Settings → Services), else the HomeCare fee
  const ids = (r.services ?? []).map((s: any) => s.serviceTypeId).filter(Boolean)
  const types = ids.length ? await ServiceType.find({ _id: { $in: ids } }).select('name fee h360Code').lean<any[]>() : []
  const serviceLines = await Promise.all(
    (r.services ?? []).map(async (s: any) => {
      const t = types.find((x) => String(x._id) === String(s.serviceTypeId))
      if (t?.h360Code) {
        const h = await price(t.h360Code)
        if (h) return line('service', h.name, h.price, h.discountPct ?? 0, 'H360', h.code)
      }
      return line('service', s.name ?? t?.name ?? 'Home care service', Number(t?.fee) || 0, 0, t?.fee ? 'HOMECARE' : 'NONE', t?.h360Code)
    }),
  )

  // tests / procedures picked from H360's catalog (code + saved price); names without a code have no price
  const items: any[] = r.testItems ?? []
  const testLines = await Promise.all(
    items.map(async (t) => {
      const h = t.code ? await price(t.code) : null
      if (h) return line('test', h.name, h.price, h.discountPct ?? 0, 'H360', h.code)
      return line('test', t.name, Number(t.price) || 0, 0, t.price ? 'SAVED' : 'NONE', t.code)
    }),
  )
  const plain = (r.tests ?? []).filter((n: string) => !items.some((t) => t.name === n)).map((n: string) => line('test', n, 0, 0, 'NONE'))

  const lines = [...serviceLines, ...testLines, ...plain]
  const gross = lines.reduce((a, l) => a + l.rate, 0)
  const discount = lines.reduce((a, l) => a + l.discount, 0)
  const net = gross - discount

  const bills = (r.billing?.invoices ?? []).filter((i: any) => !i.replacedBy)
  const billed = bills.length
    ? {
        count: bills.length,
        total: bills.reduce((a: number, i: any) => a + (Number(i.total) || 0), 0),
        discount: bills.reduce((a: number, i: any) => a + (Number(i.discount) || 0), 0),
        payable: bills.reduce((a: number, i: any) => a + (Number(i.payable) || 0), 0),
      }
    : null

  // the bill itself, line by line: is each discount what H360 gives this patient on that item?
  const checks: BillCheck[] = await Promise.all(
    bills.flatMap((b: any) =>
      (b.items ?? []).map(async (it: any): Promise<BillCheck> => {
        const name = String(it.name ?? '').trim()
        const rate = (Number(it.rate) || 0) * (Number(it.qty) || 1)
        const disc = Number(it.discount) || 0
        let hit: { discountPct?: number } | null = null
        if (name.length >= 2) {
          try {
            // the full name first; long names ("… Unico @ Home (Selected Areas)") by their first words
            const short = name.split(/\s+/).slice(0, 3).join(' ')
            for (const term of [...new Set([name.slice(0, 60), short])]) {
              const hits = await searchH360Items(term, { corporateId: corp })
              // the same name, else the catalog name the bill line starts with (the bill may add "Unico @ Home (…)")
              hit = hits.find((h) => norm(h.name) === norm(name)) ?? hits.find((h) => norm(h.name).length >= 6 && norm(name).startsWith(norm(h.name))) ?? null
              if (hit) break
            }
          } catch (e) {
            offline ??= e instanceof H360Error ? e.message : 'H360 did not answer'
          }
        }
        const pct = hit ? (reg ? hit.discountPct ?? 0 : 0) : null
        const expected = pct == null ? null : Math.round((rate * pct) / 100)
        const status = expected == null ? 'UNKNOWN' : Math.abs(disc - expected) <= 1 ? 'OK' : disc < expected ? 'LOW' : 'HIGH'
        return { invoiceNo: b.invoiceNo, name, rate, discount: disc, expectedPct: pct, expected, status }
      }),
    ),
  )

  return { uhid, registered: !!reg, corporate: reg?.corporate, patientType: reg?.patientType, lines, gross, discount, net, billed, diff: billed ? billed.payable - net : null, checks, offline }
}
