import 'server-only'
// Invoice tab ↔ H360 Billing List: find this patient's bills, add one with the hospital's own bill copy (PDF + items +
// live paid / due), and refresh paid / due later (e.g. after the patient pays the due at the counter). Read-only on H360.
import { HomecareRequest, Patient } from '../models'
import { audit } from '../audit'
import { bad, notFound } from '../api'
import { billPdf, searchBills, H360Error, type H360Bill } from '../h360'
import { parseBill } from '../bill-parse'
import { storeFile } from '../files'
import { amounts, recompute } from './billing'
import type { SessionUser } from '../auth'

type Meta = { ip?: string; userAgent?: string; client?: string }
const DAY = 86_400_000

async function patientUhid(r: any): Promise<string> {
  if (r.patientSnapshot?.uhid) return String(r.patientSnapshot.uhid)
  const p = await Patient.findById(r.patientId).select('uhid').lean<any>()
  return p?.uhid ? String(p.uhid) : ''
}

export type FoundBill = H360Bill & { onThis: boolean; elsewhere: string | null; samePatient: boolean }

/**
 * Bills for the Invoice tab: `q` = an invoice no → that bill; a UHID → that patient's bills; empty → this request's
 * patient, from 30 days before the visit until today. Each is flagged when already on this or another request.
 */
export async function findH360Bills(r: any, q = ''): Promise<{ uhid: string; bills: FoundBill[] }> {
  const uhid = await patientUhid(r)
  const term = q.trim()
  let bills: H360Bill[]
  if (/^\d{4,7}$/.test(term)) bills = await searchBills({ invoiceNo: term })
  else {
    const who = /^\d{8,12}$/.test(term) ? term : uhid
    if (!who) return { uhid, bills: [] }
    const visit = new Date(r.scheduledAt ?? r.preferred?.date ?? r.createdAt ?? Date.now())
    bills = await searchBills({ uhid: who, from: new Date(Math.min(visit.getTime(), Date.now()) - 30 * DAY), to: new Date(Math.max(visit.getTime(), Date.now()) + DAY) })
  }
  const nos = bills.map((b) => b.invoiceNo)
  const others = nos.length ? await HomecareRequest.find({ _id: { $ne: r._id }, 'billing.invoices.invoiceNo': { $in: nos } }).select('requestNo billing.invoices.invoiceNo').lean<any[]>() : []
  const mine = new Set((r.billing?.invoices ?? []).map((x: any) => x.invoiceNo))
  return {
    uhid,
    bills: bills.map((b) => ({
      ...b,
      onThis: mine.has(b.invoiceNo),
      elsewhere: others.find((o) => (o.billing?.invoices ?? []).some((x: any) => x.invoiceNo === b.invoiceNo))?.requestNo ?? null,
      samePatient: !uhid || b.uhid === uhid,
    })),
  }
}

/** PDF text → bill lines (H360's print has a text layer, so this is exact). */
async function itemsFromPdf(pdf: Buffer) {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(new Uint8Array(pdf))
    const { text } = await extractText(doc, { mergePages: true })
    return parseBill(text)
  } catch {
    return null
  }
}

async function storeBillPdf(r: any, b: H360Bill, user: SessionUser) {
  const pdf = await billPdf(b)
  const att = await storeFile({ data: pdf, mime: 'application/pdf', filename: `Unico-Bill-${b.invoiceNo}.pdf`, kind: 'INVOICE', uploadedBy: user.id, requestId: r._id, caption: `Invoice ${b.invoiceNo} (H360)` })
  return { attachmentId: att._id, parsed: await itemsFromPdf(pdf) }
}

const dhakaDay = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(iso)) : undefined)

/** Add an H360 bill to the request: the bill copy PDF, its items and the live amounts. Refreshes it if already there. */
export async function importH360Bill(r: any, invoiceNo: string, opts: { otherPatient?: boolean }, user: SessionUser, meta: Meta) {
  const [b] = (await searchBills({ invoiceNo })).filter((x) => x.invoiceNo === invoiceNo)
  if (!b) throw notFound(`Invoice ${invoiceNo} in H360`)
  const uhid = await patientUhid(r)
  if (uhid && b.uhid && b.uhid !== uhid && !opts.otherPatient) throw bad(`Invoice ${invoiceNo} is for ${b.name} (UHID ${b.uhid}), not this patient (UHID ${uhid})`, { invoiceNo: 'Different patient' })
  const elsewhere = await HomecareRequest.findOne({ _id: { $ne: r._id }, 'billing.invoices.invoiceNo': invoiceNo }).select('requestNo').lean<any>()
  if (elsewhere) throw bad(`Invoice ${invoiceNo} is already on ${elsewhere.requestNo}`, { invoiceNo: 'Already on another request' })

  const { attachmentId, parsed } = await storeBillPdf(r, b, user)
  const now = new Date()
  const fields = {
    invoiceNo: b.invoiceNo,
    date: b.at ? new Date(b.at) : now,
    ...amounts({ total: b.total, discount: b.discount, payable: b.payable, paid: b.paid, due: b.due }),
    attachmentId,
    source: 'H360' as const,
    trxId: b.trx[b.trx.length - 1],
    items: parsed?.items?.length ? parsed.items : undefined,
    note: parsed?.remarks,
    h360SyncedAt: now,
    needsDetails: undefined,
  }
  const existing = (r.billing?.invoices ?? []).find((x: any) => x.invoiceNo === invoiceNo)
  if (existing) Object.assign(existing, fields, { updatedAt: now })
  else r.billing.invoices.push({ ...fields, addedBy: user.id, addedAt: now })
  recompute(r)
  await r.save()
  await audit(user, existing ? 'request.bill_update' : 'request.bill_link', 'request', r._id, { after: { invoiceNo, total: fields.total, paid: fields.paid, due: fields.due, source: 'H360', items: fields.items?.length ?? 0, date: dhakaDay(b.at) }, label: r.requestNo }, meta)
  return { invoiceNo, status: r.billing.status }
}

/** Refresh paid / due of every H360-numbered invoice on the request; a new payment brings the newer bill copy. */
export async function syncH360Bills(r: any, user: SessionUser, meta: Meta) {
  const list = (r.billing?.invoices ?? []).filter((x: any) => /^\d{4,7}$/.test(x.invoiceNo ?? ''))
  let changed = 0
  const errors: string[] = []
  for (const inv of list) {
    try {
      const [b] = (await searchBills({ invoiceNo: inv.invoiceNo })).filter((x) => x.invoiceNo === inv.invoiceNo)
      if (!b) {
        errors.push(`${inv.invoiceNo}: not found in H360`)
        continue
      }
      const next = amounts({ total: b.total, discount: b.discount, payable: b.payable, paid: b.paid, due: b.due })
      const moved = next.paid !== inv.paid || next.due !== inv.due || next.total !== inv.total
      const newTrx = b.trx[b.trx.length - 1]
      if (moved || (inv.source === 'H360' && newTrx && newTrx !== inv.trxId)) {
        const before = { paid: inv.paid, due: inv.due, total: inv.total }
        Object.assign(inv, next, { trxId: newTrx ?? inv.trxId, updatedAt: new Date() })
        if (inv.source === 'H360' || !inv.attachmentId) {
          const { attachmentId } = await storeBillPdf(r, b, user)
          inv.attachmentId = attachmentId
        }
        changed++
        await audit(user, 'request.bill_update', 'request', r._id, { before, after: { invoiceNo: inv.invoiceNo, ...next, source: 'H360 refresh' }, label: r.requestNo }, meta)
      }
      inv.h360SyncedAt = new Date()
    } catch (e) {
      if (e instanceof H360Error && (e.code === 'AUTH' || e.code === 'NOT_CONFIGURED' || e.code === 'DOWN')) throw e
      errors.push(`${inv.invoiceNo}: ${(e as Error).message}`)
    }
  }
  recompute(r)
  await r.save()
  return { checked: list.length, changed, errors, status: r.billing.status }
}
