'use client'
// Request page → Invoice tab: the visit's hospital bills (uploaded here, or from H360 once connected), payment status
// (Paid / Partially paid / Due / Waived) and sending the bill files on WhatsApp to the patient and care team.
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Building2, Check, CheckCircle2, ClipboardPaste, Download, Eye, FileText, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Replace, Search, Trash2, Upload } from 'lucide-react'
import { api, Drawer, useToast, compressImage } from '@/components/client'
import { readBill } from '@/components/client/bill-reader'
import { useConfirmSend } from '@/components/client/ConfirmSend'
import { usePasteFiles, readClipboardFiles } from '@/components/client/paste'
import type { BillItem, ParsedBill } from '@/lib/bill-parse'
import { btnClass } from '@/components/ui'
import { useScanner } from '@/components/scanner/useScanner'
import { cx, taka, time, day as dayOf } from '@/lib/format'

type Invoice = {
  _id: string
  invoiceNo: string
  date?: string
  total: number
  discount?: number
  payable: number
  paid: number
  due: number
  attachmentId?: string
  source?: 'UPLOAD' | 'H360'
  note?: string
  trxId?: string
  items?: BillItem[]
  needsDetails?: boolean
  h360SyncedAt?: string
  /** the counter re-billed in H360: replaced by this invoice (left out of the totals) */
  replacedBy?: string
  replacedAt?: string
  /** marked paid by hand at the counter */
  manualPayment?: { amount: number; receiptNo?: string; note?: string; at?: string; byName?: string }
  /** still due in H360, but the same patient has a paid bill made close to it — likely the re-bill */
  h360Hint?: { invoiceNo: string; at?: string; total: number; payable: number; paid: number; due: number; minutes: number }
}
type Person = { id: string; name: string; role: string; phone?: string }
type Sent = { _id: string; at: string; toName?: string; to: string; status: string; error?: string; fileName?: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'Paid', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  PARTIAL: { label: 'Partially paid', cls: 'bg-[#FEF3C7] text-[#B45309]' },
  DUE: { label: 'Due', cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
  WAIVED: { label: 'Waived', cls: 'bg-slate-100 text-slate-600' },
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const num = (s: string) => (s === '' ? undefined : Math.max(0, Number(s) || 0))

export function InvoiceTab({
  requestId,
  billing,
  team,
  patient,
  sent,
  canEdit,
  canSend,
  waPaired,
  h360 = false,
  patientUhid = '',
}: {
  requestId: string
  billing: { status: string | null; override: string | null; payable: number; paid: number; due: number; invoices: Invoice[]; estimatedFee?: number | null }
  team: Person[]
  patient: { name: string; phone: string; optOut: boolean }
  sent: Sent[]
  canEdit: boolean
  canSend: boolean
  waPaired: boolean
  /** H360 login saved: show "Find in H360" and check uploaded bills against it */
  h360?: boolean
  patientUhid?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [form, setForm] = useState<null | { edit?: Invoice }>(null)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null) // invoice whose items are shown
  const [pay, setPay] = useState<null | { inv: Invoice; full: boolean }>(null) // mark paid / record payment
  async function rebill(inv: Invoice, mode: 'replace' | 'add' | 'dismiss') {
    const h = inv.h360Hint
    if (!h) return
    if (mode !== 'dismiss' && !confirm(mode === 'replace' ? `Replace ${inv.invoiceNo} with ${h.invoiceNo}?\n\n${h.invoiceNo} (${taka(h.payable)}, paid ${taka(h.paid)}) is added from H360; ${inv.invoiceNo} stays listed as "replaced" and no longer counts.` : `Add ${h.invoiceNo} from H360 as well (both count)?`)) return
    setBusy(`rebill-${inv._id}`)
    try {
      await api(`/requests/${requestId}/bills/${inv._id}/rebill`, { body: { invoiceNo: h.invoiceNo, mode } })
      toast(mode === 'replace' ? `${inv.invoiceNo} replaced by ${h.invoiceNo}` : mode === 'add' ? `${h.invoiceNo} added` : 'Hint dismissed', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const st = billing.status ? STATUS[billing.status] : null

  async function remove(inv: Invoice) {
    if (!confirm(`Remove invoice ${inv.invoiceNo} from this visit?`)) return
    setBusy(inv._id)
    try {
      await api(`/requests/${requestId}/bills/${inv._id}`, { method: 'DELETE' })
      toast(`Invoice ${inv.invoiceNo} removed`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function override(status: string | null) {
    try {
      await api(`/requests/${requestId}/bills/status`, { body: { status } })
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* status + totals */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card bg-white p-5 shadow-card">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Payment status</div>
          <div className="mt-1 flex items-center gap-2">
            {st ? <span className={cx('rounded-full px-3 py-1 text-[14px] font-bold', st.cls)}>{st.label}</span> : <span className="text-[14px] text-slate-400">No invoice yet</span>}
            {billing.override && <span className="text-[11.5px] text-slate-500">set by hand</span>}
          </div>
        </div>
        {[
          ['Payable', billing.payable],
          ['Paid', billing.paid],
          ['Due', billing.due],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">{k}</div>
            <div className={cx('mt-1 text-[20px] font-bold', k === 'Due' && (v as number) > 0 && 'text-[#B91C1C]')}>{taka(v as number)}</div>
          </div>
        ))}
        {billing.estimatedFee != null && (
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Estimated</div>
            <div className="mt-1 text-[20px] font-bold text-slate-400">{taka(billing.estimatedFee)}</div>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <select className="hc-input h-10 w-auto" value={billing.override ?? ''} onChange={(e) => override(e.target.value || null)} aria-label="Status override">
              <option value="">Status: automatic</option>
              <option value="WAIVED">Mark waived</option>
              <option value="PAID">Mark paid</option>
              <option value="DUE">Mark due</option>
            </select>
          )}
          {canEdit && (
            <button type="button" className={btnClass('p')} onClick={() => setForm({})}>
              <Plus size={16} /> Add invoice
            </button>
          )}
          {canSend && billing.invoices.length > 0 && (
            <button type="button" className={btnClass('g')} onClick={() => setSending(true)}>
              <MessageCircle size={16} /> Send invoice
            </button>
          )}
        </div>
      </section>

      {h360 && <H360Bills requestId={requestId} canEdit={canEdit} hasNumbered={billing.invoices.some((i) => /^\d{4,7}$/.test(i.invoiceNo ?? ''))} />}

      {/* invoices */}
      <section className="rounded-card bg-white shadow-card">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-base font-bold">Invoices · {billing.invoices.length}</h2>
          <span className="text-[12px] text-slate-400">{h360 ? 'Add from H360 above, or upload / paste the bill' : 'Upload the bill from H360 (PDF or photo) and its amounts'}</span>
        </div>
        {!billing.invoices.length ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <FileText size={24} />
            </span>
            <div className="font-bold">No invoice yet</div>
            <div className="max-w-[440px] text-[13px] text-slate-500">Add the hospital bill for this visit{h360 ? ' from the H360 list above, or' : ':'} upload or paste the PDF / photo — it is read and the amounts are filled in. The payment status follows paid vs due.</div>
            {canEdit && (
              <button type="button" className={btnClass('p', 'md', 'mt-2')} onClick={() => setForm({})}>
                <Upload size={16} /> Upload invoice
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto px-2 pb-3 pt-2">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-[.06em] text-slate-500">
                  {['Invoice', 'Date', 'Total', 'Discount', 'Payable', 'Paid', 'Due', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((inv) => {
                  const s = inv.replacedBy ? { label: 'Replaced', cls: 'bg-slate-100 text-slate-500' } : inv.needsDetails ? { label: 'Needs details', cls: 'bg-[#FEF3C7] text-[#B45309]' } : inv.due <= 0 ? STATUS.PAID : inv.paid <= 0 ? STATUS.DUE : STATUS.PARTIAL
                  return (
                    <Fragment key={inv._id}>
                    <tr className={cx('border-t border-slate-100', inv.replacedBy && 'text-slate-400 [&_td:nth-child(n+3):nth-child(-n+7)]:line-through')}>
                      <td className="px-3 py-2.5 font-semibold">
                        {inv.invoiceNo || <span className="text-[#B45309]">—</span>}
                        {inv.source === 'H360' && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">H360</span>}
                        {inv.replacedBy && <span className="block text-[11.5px] font-semibold text-slate-500">replaced by {inv.replacedBy}</span>}
                        {!!inv.items?.length && (
                          <button type="button" onClick={() => setOpen(open === inv._id ? null : inv._id)} className="block text-[11.5px] font-semibold text-primary-700 hover:underline">
                            {inv.items.length} items {open === inv._id ? '▴' : '▾'}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{day(inv.date)}</td>
                      <td className="px-3 py-2.5">{taka(inv.total)}</td>
                      <td className="px-3 py-2.5">{inv.discount ? taka(inv.discount) : '—'}</td>
                      <td className="px-3 py-2.5 font-semibold">{taka(inv.payable)}</td>
                      <td className="px-3 py-2.5">{taka(inv.paid)}</td>
                      <td className={cx('px-3 py-2.5', inv.due > 0 && 'font-semibold text-[#B91C1C]')}>{taka(inv.due)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', s.cls)}>{s.label}</span>
                        {inv.manualPayment && !inv.replacedBy && (
                          <span className="mt-0.5 block text-[11px] leading-[14px] text-slate-500" title={inv.manualPayment.note}>
                            by hand{inv.manualPayment.receiptNo ? ` · MR ${inv.manualPayment.receiptNo}` : ''}
                            {inv.manualPayment.at ? ` · ${dayOf(inv.manualPayment.at)} ${time(inv.manualPayment.at)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          {inv.attachmentId ? (
                            <a href={`/api/v1/attachments/${inv.attachmentId}`} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-primary-700" title="View file">
                              <Eye size={16} />
                            </a>
                          ) : (
                            <span className="flex h-8 items-center px-1 text-[11.5px] text-[#B45309]">no file</span>
                          )}
                          {canEdit && !inv.replacedBy && inv.due > 0 && !inv.needsDetails && (
                            <>
                              <button type="button" onClick={() => setPay({ inv, full: true })} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-[#15803D] hover:bg-[#F0FDF4]" title="Paid in full at the counter">
                                <CheckCircle2 size={15} /> Mark paid
                              </button>
                              <button type="button" onClick={() => setPay({ inv, full: false })} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-primary-700" title="Record a payment (amount + receipt no)">
                                <Banknote size={15} />
                              </button>
                            </>
                          )}
                          {canEdit && (
                            <>
                              <button type="button" onClick={() => setForm({ edit: inv })} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-primary-700" title={inv.needsDetails ? 'Fill in the invoice no and amounts' : 'Edit amounts'}>
                                <Pencil size={15} />
                              </button>
                              <button type="button" disabled={busy === inv._id} onClick={() => remove(inv)} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-[#B91C1C]" title="Remove">
                                {busy === inv._id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {inv.h360Hint && !inv.replacedBy && (
                      <tr>
                        <td colSpan={9} className="px-3 pb-3">
                          <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-[#FFFBEB] px-3 py-2.5 text-[13px] text-[#92400E] ring-1 ring-[#FDE68A]">
                            <Replace size={16} className="flex-none" />
                            <span className="min-w-0 flex-1">
                              Still due in H360. <b>{inv.h360Hint.invoiceNo}</b>
                              {inv.h360Hint.at ? ` · ${dayOf(inv.h360Hint.at)} ${time(inv.h360Hint.at)}` : ''} ({Math.abs(inv.h360Hint.minutes)} min {inv.h360Hint.minutes >= 0 ? 'later' : 'earlier'}) · {taka(inv.h360Hint.total)} · paid {taka(inv.h360Hint.paid)}
                              {inv.h360Hint.due > 0 ? ` · due ${taka(inv.h360Hint.due)}` : ''} — looks like the re-billed copy.
                            </span>
                            {canEdit && (
                              <span className="flex flex-wrap gap-1.5">
                                <button type="button" disabled={busy === `rebill-${inv._id}`} onClick={() => rebill(inv, 'replace')} className={btnClass('p', 'sm')}>
                                  {busy === `rebill-${inv._id}` ? <Loader2 size={14} className="animate-spin" /> : <Replace size={14} />} Replace with {inv.h360Hint.invoiceNo}
                                </button>
                                <button type="button" disabled={busy === `rebill-${inv._id}`} onClick={() => rebill(inv, 'add')} className={btnClass('o', 'sm', 'bg-white')}>
                                  Add {inv.h360Hint.invoiceNo} too
                                </button>
                                <button type="button" disabled={busy === `rebill-${inv._id}`} onClick={() => rebill(inv, 'dismiss')} className={btnClass('ghost', 'sm')}>
                                  Dismiss
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {open === inv._id && !!inv.items?.length && (
                      <tr>
                        <td colSpan={9} className="px-3 pb-3">
                          <div className="rounded-lg border border-slate-200">
                            <ItemList items={inv.items} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* send history */}
      {sent.length > 0 && (
        <section className="rounded-card bg-white p-5 shadow-card">
          <h2 className="mb-2 text-base font-bold">Sent on WhatsApp</h2>
          <ul className="flex flex-col divide-y divide-slate-100 text-[13px]">
            {sent.map((m) => (
              <li key={m._id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <span className="font-semibold">{m.toName ?? `+${m.to}`}</span>
                <span className="text-slate-500">{m.fileName}</span>
                <span className="text-slate-400">{new Date(m.at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                <span className={cx('ml-auto font-semibold', ['SENT', 'DELIVERED', 'SENT_CONFIRMED'].includes(m.status) ? 'text-[#15803D]' : m.status === 'FAILED' ? 'text-[#B91C1C]' : 'text-[#B45309]')}>
                  {['SENT', 'DELIVERED', 'SENT_CONFIRMED'].includes(m.status) ? 'Sent ✓' : m.status === 'FAILED' ? `Failed${m.error ? ` · ${m.error}` : ''}` : 'Sending…'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {form && <InvoiceForm requestId={requestId} edit={form.edit} h360={h360} patientUhid={patientUhid} onClose={() => setForm(null)} />}
      {pay && <PaymentForm requestId={requestId} inv={pay.inv} full={pay.full} onClose={() => setPay(null)} />}
      {sending && <SendDrawer requestId={requestId} invoices={billing.invoices} team={team} patient={patient} waPaired={waPaired} onClose={() => setSending(false)} />}
    </div>
  )
}

type H360Bill = { invoiceNo: string; at: string | null; uhid: string; name: string; phone: string; total: number; discount: number; payable: number; paid: number; due: number; type: string; trx: string[]; onThis?: boolean; elsewhere?: string | null; samePatient?: boolean }
type Match = { kind: 'checking' } | { kind: 'found'; bill: H360Bill; agrees: boolean } | { kind: 'none' } | { kind: 'offline'; error?: string }

const dhakaDay = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(iso)) : '')
const dayTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')

/** Find the H360 bill a read bill belongs to: by its invoice no, else this patient's bills by TRX id or amount + day. */
async function matchInH360(requestId: string, p: ParsedBill): Promise<Match> {
  try {
    const nos = [p.invoiceNo, ...p.invoiceCandidates].filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
    for (const no of nos) {
      const r = await api<{ bills: H360Bill[]; offline?: boolean; error?: string }>(`/requests/${requestId}/bills/h360?q=${no}`)
      if (r.offline) return { kind: 'offline', error: r.error }
      const b = r.bills.find((x) => x.invoiceNo === no)
      if (b) return { kind: 'found', bill: b, agrees: agrees(b, p) }
    }
    const r = await api<{ bills: H360Bill[]; offline?: boolean; error?: string }>(`/requests/${requestId}/bills/h360`)
    if (r.offline) return { kind: 'offline', error: r.error }
    const total = p.subtotal ?? p.billAmount
    const b =
      (p.trxId && r.bills.find((x) => x.trx.includes(p.trxId!))) ||
      (total != null && r.bills.find((x) => Math.abs(x.total - total) < 1 && (!p.date || dhakaDay(x.at) === p.date))) ||
      (total != null && r.bills.filter((x) => Math.abs(x.total - total) < 1).length === 1 ? r.bills.find((x) => Math.abs(x.total - total) < 1) : undefined)
    return b ? { kind: 'found', bill: b, agrees: agrees(b, p) } : { kind: 'none' }
  } catch (e: any) {
    return { kind: 'offline', error: e.message }
  }
}
const agrees = (b: H360Bill, p: ParsedBill) => {
  const total = p.subtotal ?? p.billAmount
  return total == null || Math.abs(b.total - total) < 1
}

function InvoiceForm({ requestId, edit, h360, patientUhid, onClose }: { requestId: string; edit?: Invoice; h360: boolean; patientUhid: string; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const { scan, scanner } = useScanner()
  const [v, setV] = useState({
    invoiceNo: edit?.invoiceNo ?? '',
    date: edit?.date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(edit.date)) : today(),
    total: edit && !edit.needsDetails ? String(edit.total) : '',
    discount: edit?.discount ? String(edit.discount) : '',
    paid: edit && !edit.needsDetails ? String(edit.paid) : '',
    note: edit?.note ?? '',
  })
  const [items, setItems] = useState<BillItem[] | undefined>(edit?.items)
  const [trxId, setTrxId] = useState<string | undefined>(edit?.trxId)
  const [busy, setBusy] = useState<null | 'save' | 'file' | 'h360'>(null)
  const [reading, setReading] = useState<{ pct: number; label: string } | null>(null)
  const [read, setRead] = useState<ParsedBill | null>(null)
  const [auto, setAuto] = useState<Set<string>>(new Set()) // fields filled from the bill, tinted until edited
  const [match, setMatch] = useState<Match | null>(null)
  const [errs, setErrs] = useState<{ invoiceNo?: string; total?: string; file?: string }>({})
  const [showItems, setShowItems] = useState(false)
  const total = num(v.total) ?? 0
  const payable = Math.max(0, total - (num(v.discount) ?? 0))
  const due = Math.max(0, payable - (num(v.paid) ?? 0))
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.value })
    setAuto((s) => {
      const n = new Set(s)
      n.delete(k)
      return n
    })
    if (k === 'invoiceNo' || k === 'total') setErrs((x) => ({ ...x, [k]: undefined }))
  }
  const tint = (k: string) => (auto.has(k) ? 'border-[#F59E0B] bg-[#FFFBEB]' : '')
  const uhidMismatch = (read?.uhid && patientUhid && read.uhid !== patientUhid) || (match?.kind === 'found' && match.bill.uhid && patientUhid && match.bill.uhid !== patientUhid)

  async function useFile(f: File) {
    setFile(f)
    setErrs((x) => ({ ...x, file: undefined }))
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return f.type.startsWith('image/') ? URL.createObjectURL(f) : null
    })
    if (edit && !edit.needsDetails) return // replacing the file of a finished invoice: keep the typed amounts
    // read the bill → fill the fields → check it against the bill copy in H360
    setReading({ pct: 5, label: 'Reading the bill…' })
    setMatch(null)
    try {
      const p = await readBill(f, (pct, label) => setReading({ pct, label }))
      setRead(p)
      const filled: Record<string, string> = {}
      if (p.invoiceNo) filled.invoiceNo = p.invoiceNo
      if (p.date) filled.date = p.date
      const t = p.subtotal ?? p.billAmount
      if (t != null) filled.total = String(t)
      if (p.discount != null) filled.discount = p.discount ? String(p.discount) : ''
      if (p.paid != null) filled.paid = String(p.paid)
      if (p.remarks && !v.note) filled.note = p.remarks
      setV((s) => ({ ...s, ...filled }))
      setAuto(new Set(Object.keys(filled)))
      if (p.items.length) setItems(p.items)
      if (p.trxId) setTrxId(p.trxId)
      setReading(null)
      if (h360 && p.quality !== 'none') {
        setMatch({ kind: 'checking' })
        const m = await matchInH360(requestId, p)
        setMatch(m)
        if (m.kind === 'found') {
          // H360 is the source of truth: its invoice no and the live paid / due (the printed copy can be older)
          const b = m.bill
          setV((s) => ({ ...s, invoiceNo: b.invoiceNo, date: dhakaDay(b.at) || s.date, total: String(b.total), discount: b.discount ? String(b.discount) : '', paid: String(b.paid) }))
          setAuto((s) => new Set([...s, 'invoiceNo', 'total', 'paid']))
          setTrxId(b.trx[b.trx.length - 1] ?? p.trxId)
        }
      }
    } catch (e: any) {
      setReading(null)
      toast(`Couldn’t read the bill (${e.message}) — please type the amounts`, 'err')
    }
  }
  async function onPicked(picked: File[]) {
    // a photo of the bill opens the scanner (a multi-page bill becomes one PDF)
    const out = await scan(picked, { title: 'Scan bill' })
    if (out?.[0]) await useFile(out[0])
  }
  const { over, dropProps } = usePasteFiles(onPicked)
  async function pasteButton() {
    const r = await readClipboardFiles()
    if (r === 'denied') return toast('The browser blocked the clipboard — click here and press Ctrl+V', 'err')
    if (!r.length) return toast('Nothing to paste — copy the bill image first', 'err')
    await onPicked(r)
  }

  async function upload() {
    const form = new FormData()
    form.append('file', file!.type.startsWith('image/') ? await compressImage(file!, false) : file!)
    form.append('kind', 'INVOICE')
    form.append('requestId', requestId)
    form.append('caption', v.invoiceNo.trim() ? `Invoice ${v.invoiceNo.trim()}` : 'Invoice (details to fill)')
    return (await api<{ id: string }>('/attachments', { form })).id
  }

  async function save() {
    const e: typeof errs = {}
    if (!v.invoiceNo.trim()) e.invoiceNo = 'Enter the invoice no (it is on the bill, top right)'
    if (v.total === '') e.total = 'Enter the bill total'
    setErrs(e)
    if (e.invoiceNo || e.total) {
      document.getElementById(e.invoiceNo ? 'inv-no' : 'inv-total')?.focus()
      return
    }
    setBusy('save')
    try {
      const attachmentId = file ? await upload() : undefined
      const body = { invoiceNo: v.invoiceNo.trim(), date: v.date, total, discount: num(v.discount) ?? 0, paid: num(v.paid) ?? 0, note: v.note.trim() || undefined, attachmentId, items, trxId }
      if (edit) await api(`/requests/${requestId}/bills/${edit._id}`, { method: 'PATCH', body })
      else await api(`/requests/${requestId}/bills`, { body: { ...body, source: 'UPLOAD' } })
      toast(edit ? `Invoice ${body.invoiceNo} updated` : `Invoice ${body.invoiceNo} added`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      if (e.fields?.invoiceNo) setErrs((x) => ({ ...x, invoiceNo: e.message }))
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  /** Keep the bill now, finish the invoice no / amounts later. */
  async function saveFileOnly() {
    if (!file) return setErrs((x) => ({ ...x, file: 'Choose, drop or paste the bill first' }))
    setBusy('file')
    try {
      const attachmentId = await upload()
      await api(`/requests/${requestId}/bills`, { body: { needsDetails: true, attachmentId, invoiceNo: v.invoiceNo.trim(), total: num(v.total) ?? 0, paid: num(v.paid) ?? 0, discount: num(v.discount) ?? 0, date: v.date, items, trxId, source: 'UPLOAD' } })
      toast('Bill saved — fill its amounts later', 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function useH360Copy(b: H360Bill) {
    setBusy('h360')
    try {
      await api(`/requests/${requestId}/bills/h360`, { body: { invoiceNo: b.invoiceNo, otherPatient: !!uhidMismatch } })
      toast(`Invoice ${b.invoiceNo} added from H360`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const fileLabel = file ? file.name : edit?.attachmentId ? 'Replace the bill file (optional)' : 'Choose, drop or paste (Ctrl+V) the bill'
  return (
    <Drawer
      open
      onClose={onClose}
      title={edit ? (edit.needsDetails ? 'Finish invoice' : `Edit invoice ${edit.invoiceNo}`) : 'Add invoice'}
      sub="The bill from H360 — PDF, a clear photo or a pasted screenshot. It is read and checked against H360."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          {!edit && file && (!v.invoiceNo.trim() || v.total === '') && (
            <button type="button" className={btnClass('o')} disabled={!!busy || !!reading} onClick={saveFileOnly}>
              {busy === 'file' && <Loader2 size={16} className="animate-spin" />} Save bill file only
            </button>
          )}
          <button type="button" className={btnClass('p')} disabled={!!busy || !!reading} onClick={save}>
            {busy === 'save' && <Loader2 size={16} className="animate-spin" />} {busy === 'save' && file ? 'Uploading…' : edit ? 'Save' : 'Add invoice'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div
          {...dropProps}
          className={cx('relative rounded-xl border-[1.5px] border-dashed transition-colors', over ? 'border-primary bg-primary-50' : file ? 'border-primary bg-primary-50/50' : errs.file ? 'border-[#F87171] bg-[#FEF2F2]' : 'border-slate-300 bg-slate-50')}
        >
          <label className="flex cursor-pointer flex-col items-center gap-1.5 px-4 py-5 text-center hover:bg-slate-100/60">
            {preview ? <img src={preview} alt="" className="max-h-28 rounded-md object-contain shadow-sm" /> : <Upload size={20} className="text-primary-700" />}
            <span className="max-w-full truncate text-[14px] font-semibold">{over ? 'Drop the bill here' : fileLabel}</span>
            <span className="text-[12px] text-slate-500">PDF, JPG or PNG · up to 4 MB · drag & drop or Ctrl+V works too</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const picked = Array.from(e.target.files ?? [])
                e.target.value = ''
                await onPicked(picked)
              }}
            />
          </label>
          <button type="button" onClick={pasteButton} className="absolute right-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">
            <ClipboardPaste size={14} /> Paste image
          </button>
        </div>
        {errs.file && <span className="-mt-2 text-[12px] font-semibold text-[#B91C1C]">{errs.file}</span>}
        {scanner}

        {reading && (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
              <Loader2 size={14} className="animate-spin" /> {reading.label} {reading.pct}%
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${reading.pct}%` }} />
            </div>
          </div>
        )}
        {read && !reading && (
          <div className={cx('rounded-lg px-3 py-2.5 text-[13px]', read.quality === 'full' ? 'bg-[#F0FDF4] text-[#166534]' : read.quality === 'partial' ? 'bg-[#FFFBEB] text-[#92400E]' : 'bg-slate-50 text-slate-600')}>
            {read.quality === 'none' ? (
              'Couldn’t read this bill — please type the invoice no and amounts.'
            ) : (
              <>
                <b>Read from the bill:</b> {[read.items.length && `${read.items.length} items`, (read.subtotal ?? read.billAmount) != null && taka(read.subtotal ?? read.billAmount ?? 0), read.due != null && `due ${taka(read.due)}`].filter(Boolean).join(' · ')}
                {read.quality === 'full' ? ' · totals add up ✓' : ' · some numbers were unclear — check the amber fields'}
              </>
            )}
          </div>
        )}
        {match?.kind === 'checking' && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
            <Loader2 size={14} className="animate-spin" /> Matching with the bill copy in H360…
          </div>
        )}
        {match?.kind === 'found' && (
          <div className={cx('rounded-lg border px-3 py-2.5 text-[13px]', match.agrees && !uhidMismatch ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]' : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]')}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Building2 size={14} />
              <b>{match.agrees ? 'Matches H360 bill' : 'H360 bill found, amounts differ'} {match.bill.invoiceNo}</b>
              <span>· {dayTime(match.bill.at)} · {taka(match.bill.total)} · paid {taka(match.bill.paid)} · due {taka(match.bill.due)} (live)</span>
            </div>
            {!match.agrees && <div className="mt-1">The photo reads {taka(read?.subtotal ?? read?.billAmount ?? 0)} — the fields now use H360’s figures.</div>}
            <button type="button" disabled={!!busy} onClick={() => useH360Copy(match.bill)} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
              {busy === 'h360' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Use H360’s own bill copy (PDF) instead
            </button>
          </div>
        )}
        {match?.kind === 'none' && <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">No matching bill found in H360 for this patient — check the invoice no.</div>}
        {match?.kind === 'offline' && <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">Couldn’t check H360 right now{match.error ? ` (${match.error})` : ''} — the amounts come from the bill only.</div>}
        {uhidMismatch && (
          <div className="rounded-lg bg-[#FEE2E2] px-3 py-2.5 text-[13px] font-semibold text-[#B91C1C]">
            This bill is for UHID {match?.kind === 'found' ? match.bill.uhid : read?.uhid}
            {match?.kind === 'found' ? ` (${match.bill.name})` : read?.patientName ? ` (${read.patientName})` : ''} — this patient is UHID {patientUhid}. Check it’s the right bill.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="hc-label">Invoice no *</span>
            <input id="inv-no" className={cx('hc-input', tint('invoiceNo'), errs.invoiceNo && 'border-[#F87171]')} value={v.invoiceNo} onChange={set('invoiceNo')} placeholder="e.g. 267543" />
            {errs.invoiceNo && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{errs.invoiceNo}</span>}
          </label>
          <label>
            <span className="hc-label">Date</span>
            <input type="date" className={cx('hc-input', tint('date'))} value={v.date} onChange={set('date')} />
          </label>
          <label>
            <span className="hc-label">Total (৳) *</span>
            <input id="inv-total" className={cx('hc-input', tint('total'), errs.total && 'border-[#F87171]')} inputMode="decimal" value={v.total} onChange={set('total')} />
            {errs.total && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{errs.total}</span>}
          </label>
          <label>
            <span className="hc-label">Discount (৳)</span>
            <input className={cx('hc-input', tint('discount'))} inputMode="decimal" value={v.discount} onChange={set('discount')} placeholder="0" />
          </label>
          <label>
            <span className="hc-label">Paid (৳)</span>
            <input className={cx('hc-input', tint('paid'))} inputMode="decimal" value={v.paid} onChange={set('paid')} placeholder="0" />
          </label>
          <div>
            <span className="hc-label">Payable · Due</span>
            <div className="flex h-10 items-center gap-2 text-[14px]">
              <b>{taka(payable)}</b> · <b className={due > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'}>{due > 0 ? `${taka(due)} due` : 'fully paid'}</b>
            </div>
          </div>
        </div>
        {auto.size > 0 && <div className="-mt-1 text-[12px] text-[#B45309]">Amber fields were filled from the bill{match?.kind === 'found' ? ' and H360' : ''} — check them before saving.</div>}
        <label>
          <span className="hc-label">Note</span>
          <input className={cx('hc-input', tint('note'))} value={v.note} onChange={set('note')} placeholder="e.g. paid by bKash, rest at next visit" />
        </label>
        {!!items?.length && (
          <div className="rounded-lg border border-slate-200">
            <button type="button" onClick={() => setShowItems((x) => !x)} className="flex w-full items-center justify-between px-3 py-2 text-[13px] font-semibold text-slate-600">
              <span>
                Bill items · {items.length} · {taka(items.reduce((a, i) => a + i.amount, 0))}
              </span>
              <span className="text-primary-700">{showItems ? 'Hide' : 'Show'}</span>
            </button>
            {showItems && <ItemList items={items} />}
          </div>
        )}
      </div>
    </Drawer>
  )
}

function ItemList({ items }: { items: BillItem[] }) {
  return (
    <ul className="divide-y divide-slate-100 border-t border-slate-100 text-[12.5px]">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 px-3 py-1.5">
          <span className="min-w-0 flex-1">{it.name}</span>
          <span className="text-slate-500">
            {it.qty > 1 ? `${it.qty} × ` : ''}
            {taka(it.rate)}
            {it.discount ? ` − ${taka(it.discount)}` : ''}
          </span>
          <b className="w-20 text-right">{taka(it.amount)}</b>
        </li>
      ))}
    </ul>
  )
}

/** Invoice tab → "From H360": this patient's bills in H360's Billing List, live paid / due, one click to add. */
function H360Bills({ requestId, canEdit, hasNumbered }: { requestId: string; canEdit: boolean; hasNumbered: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [state, setState] = useState<{ loading: boolean; bills: H360Bill[]; uhid?: string; error?: string }>({ loading: true, bills: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async (term: string) => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const r = await api<{ bills: H360Bill[]; uhid: string; offline?: boolean; error?: string }>(`/requests/${requestId}/bills/h360${term ? `?q=${encodeURIComponent(term)}` : ''}`)
      setState({ loading: false, bills: r.bills, uhid: r.uhid, error: r.offline ? r.error ?? 'H360 is not answering' : undefined })
    } catch (e: any) {
      setState({ loading: false, bills: [], error: e.message })
    }
  }, [requestId])
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), q ? 400 : 0)
    return () => clearTimeout(t)
  }, [q, load])

  async function add(b: H360Bill) {
    if (!b.samePatient && !confirm(`Invoice ${b.invoiceNo} is for ${b.name} (UHID ${b.uhid}), not this patient. Add it anyway?`)) return
    setBusy(b.invoiceNo)
    try {
      await api(`/requests/${requestId}/bills/h360`, { body: { invoiceNo: b.invoiceNo, otherPatient: !b.samePatient } })
      toast(`Invoice ${b.invoiceNo} added with H360’s bill copy`, 'ok')
      router.refresh()
      load(q.trim())
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function refresh() {
    setBusy('sync')
    try {
      const r = await api<{ checked: number; changed: number; errors: string[]; hints?: { invoiceNo: string; hint: { invoiceNo: string } }[]; kept?: string[] }>(`/requests/${requestId}/bills/h360/sync`, { method: 'POST' })
      const hint = r.hints?.[0]
      toast(
        hint
          ? `${hint.invoiceNo} is still due in H360 — ${hint.hint.invoiceNo} looks like its paid re-bill (see below)`
          : r.changed
            ? `${r.changed} invoice${r.changed === 1 ? '' : 's'} updated from H360`
            : `Up to date with H360 (${r.checked} checked)${r.kept?.length ? ` · kept the payment marked by hand on ${r.kept.join(', ')}` : ''}`,
        r.errors.length ? 'err' : 'ok',
      )
      router.refresh()
      load(q.trim())
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-card bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Building2 size={17} className="text-primary-700" /> Find in H360
        </h2>
        <span className="text-[12px] text-slate-400">{state.uhid ? `Bills of UHID ${state.uhid} · last 30 days` : 'Billing List'}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="hc-input h-10 w-[260px] pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no or UHID" inputMode="numeric" />
          </div>
          {hasNumbered && canEdit && (
            <button type="button" className={btnClass('o')} disabled={busy === 'sync'} onClick={refresh} title="Update paid / due of this visit's invoices from H360">
              {busy === 'sync' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh paid / due
            </button>
          )}
        </div>
      </div>
      {state.loading && !state.bills.length ? (
        <div className="flex items-center gap-2 px-5 py-6 text-[13px] text-slate-500">
          <Loader2 size={15} className="animate-spin" /> Searching H360’s Billing List…
        </div>
      ) : state.error ? (
        <div className="px-5 py-5 text-[13px] text-[#B45309]">{state.error}</div>
      ) : !state.bills.length ? (
        <div className="px-5 py-5 text-[13px] text-slate-500">{q ? `No H360 bill for “${q}”.` : 'No H360 bills for this patient in the last 30 days — search by invoice no.'}</div>
      ) : (
        <div className="overflow-x-auto px-2 pb-3 pt-2">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-[.06em] text-slate-500">
                {['Invoice', 'Billed', 'Patient', 'Total', 'Paid', 'Due', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.bills.map((b) => (
                <tr key={b.invoiceNo} className={cx('border-t border-slate-100', state.loading && 'opacity-60')}>
                  <td className="px-3 py-2.5 font-semibold">
                    {b.invoiceNo}
                    {b.type && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">{b.type}</span>}
                  </td>
                  <td className="px-3 py-2.5">{dayTime(b.at)}</td>
                  <td className="px-3 py-2.5">
                    {b.name}
                    <span className={cx('block text-[11.5px]', b.samePatient ? 'text-slate-400' : 'font-semibold text-[#B91C1C]')}>UHID {b.uhid}{!b.samePatient && ' · other patient'}</span>
                  </td>
                  <td className="px-3 py-2.5">{taka(b.total)}{b.discount ? <span className="block text-[11.5px] text-slate-400">− {taka(b.discount)} disc.</span> : null}</td>
                  <td className="px-3 py-2.5">{taka(b.paid)}</td>
                  <td className={cx('px-3 py-2.5', b.due > 0 ? 'font-semibold text-[#B91C1C]' : 'text-[#15803D]')}>{b.due > 0 ? taka(b.due) : 'Paid'}</td>
                  <td className="px-3 py-2.5 text-right">
                    {b.onThis ? (
                      <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#15803D]">
                        <Check size={14} /> Added
                      </span>
                    ) : b.elsewhere ? (
                      <span className="text-[12px] text-slate-500">On {b.elsewhere}</span>
                    ) : canEdit ? (
                      <button type="button" disabled={!!busy} onClick={() => add(b)} className={btnClass('p', 'sm')}>
                        {busy === b.invoiceNo ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add bill
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SendDrawer({ requestId, invoices, team, patient, waPaired, onClose }: { requestId: string; invoices: Invoice[]; team: Person[]; patient: { name: string; phone: string; optOut: boolean }; waPaired: boolean; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const withFile = invoices.filter((i) => i.attachmentId)
  const [ids, setIds] = useState<string[]>(withFile.map((i) => i._id))
  const [toPatient, setToPatient] = useState(!patient.optOut && !!patient.phone)
  const [staff, setStaff] = useState<string[]>(team.filter((p) => p.role !== 'DRIVER').map((p) => p.id))
  const [busy, setBusy] = useState(false)
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const { confirmSend, confirmDialog } = useConfirmSend()

  async function send() {
    const chosen = invoices.filter((i) => ids.includes(i._id))
    const ok = await confirmSend({
      title: `Send ${chosen.length === 1 ? `bill ${chosen[0].invoiceNo}` : `${chosen.length} bills`} on WhatsApp?`,
      to: [...(toPatient ? [{ name: patient.name, phone: patient.phone, note: 'patient' }] : []), ...team.filter((p) => staff.includes(p.id)).map((p) => ({ name: p.name, phone: p.phone, note: p.role === 'DRIVER' ? 'driver' : 'care team' }))],
      files: chosen.map((i) => `Unico-Bill-${i.invoiceNo}.pdf · ${taka(i.payable)}${i.due > 0 ? ` · due ${taka(i.due)}` : ' · paid'}`),
      linked: waPaired,
      note: 'Each person gets the bill file with a short caption, from the hospital WhatsApp number.',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await api<{ sent: number }>(`/requests/${requestId}/bills/send`, { body: { invoiceIds: ids, patient: toPatient, staffIds: staff } })
      toast(`${r.sent} WhatsApp message${r.sent === 1 ? '' : 's'} queued with the bill`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  const check = (on: boolean, onChange: () => void, label: React.ReactNode, disabled = false) => (
    <label className={cx('flex items-center gap-2.5 rounded-lg px-2 py-2 text-[14px]', disabled ? 'opacity-50' : 'hover:bg-slate-50')}>
      <input type="checkbox" className="size-4 accent-[#0090CA]" checked={on} disabled={disabled} onChange={onChange} /> {label}
    </label>
  )
  return (
    <Drawer
      open
      onClose={onClose}
      title="Send invoice on WhatsApp"
      sub="The bill file is sent from the hospital WhatsApp number"
      width={480}
      footer={
        <div className="flex justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass('g')} disabled={busy || !waPaired || !ids.length || (!toPatient && !staff.length)} onClick={send}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />} Send
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {confirmDialog}
        {!waPaired && <div className="rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]">WhatsApp is not paired — files can only be sent from the paired hospital number. Pair it in Settings → WhatsApp, or download the file and send it yourself.</div>}
        <div>
          <span className="hc-label">Invoices</span>
          {invoices.map((i) =>
            check(
              ids.includes(i._id),
              () => setIds(toggle(ids, i._id)),
              <span>
                <b>{i.invoiceNo}</b> · {taka(i.payable)} {i.due > 0 ? <span className="text-[#B91C1C]">· due {taka(i.due)}</span> : <span className="text-[#15803D]">· paid</span>}
                {!i.attachmentId && <span className="text-[#B45309]"> · no file uploaded</span>}
                {i.attachmentId && (
                  <a href={`/api/v1/attachments/${i.attachmentId}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-[12px] text-primary-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                    <Download size={12} /> file
                  </a>
                )}
              </span>,
              !i.attachmentId,
            ),
          )}
        </div>
        <div>
          <span className="hc-label">Send to</span>
          {check(toPatient, () => setToPatient(!toPatient), <span>Patient · {patient.name} {patient.optOut ? '(opted out of WhatsApp)' : patient.phone ? `· ${patient.phone}` : '(no phone)'}</span>, patient.optOut || !patient.phone)}
          {team.map((p) => check(staff.includes(p.id), () => setStaff(toggle(staff, p.id)), <span>{p.name} · {p.role === 'DRIVER' ? 'Driver' : 'Care team'}</span>, !p.phone))}
        </div>
      </div>
    </Drawer>
  )
}

/** Paid at the counter, marked by hand: in full or an amount, with the receipt / MR no. A later H360 refresh keeps it. */
function PaymentForm({ requestId, inv, full: fullStart, onClose }: { requestId: string; inv: Invoice; full: boolean; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [full, setFull] = useState(fullStart)
  const [amount, setAmount] = useState(String(inv.payable ?? 0))
  const [receiptNo, setReceiptNo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const amt = full ? inv.payable : Number(amount) || 0
  async function save() {
    if (!full && !(amt > 0)) return toast('Enter the amount paid', 'err')
    setBusy(true)
    try {
      await api(`/requests/${requestId}/bills/${inv._id}/payment`, { body: { amount: full ? undefined : amt, receiptNo: receiptNo.trim() || undefined, note: note.trim() || undefined } })
      toast(`${inv.invoiceNo || 'Invoice'} · ${amt >= inv.payable ? 'paid in full' : `${taka(amt)} paid`}`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title={full ? `Mark ${inv.invoiceNo || 'invoice'} paid` : `Record payment · ${inv.invoiceNo || 'invoice'}`}
      sub={`Payable ${taka(inv.payable)} · paid so far ${taka(inv.paid)} · due ${taka(inv.due)}`}
      width={440}
      footer={
        <div className="flex w-full justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass('g')} disabled={busy} onClick={save}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {full ? `Mark paid · ${taka(inv.payable)}` : `Save · ${taka(amt)}`}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
          {(
            [
              [true, 'Paid in full'],
              [false, 'Part / other amount'],
            ] as const
          ).map(([v, l]) => (
            <button key={l} type="button" onClick={() => setFull(v)} className={cx('h-9 flex-1 rounded-lg text-sm font-semibold', full === v ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}>
              {l}
            </button>
          ))}
        </div>
        {!full && (
          <label>
            <span className="hc-label">Amount paid (total so far, ৳)</span>
            <input className="hc-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
        )}
        <label>
          <span className="hc-label">Receipt / MR no (optional)</span>
          <input className="hc-input" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="e.g. 202610117" />
        </label>
        <label>
          <span className="hc-label">Note (optional)</span>
          <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid at cash counter, bKash" />
        </label>
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
          Recorded with your name and the time. “Refresh paid / due” from H360 won’t lower it — if H360 later shows the payment, the numbers simply match.
        </div>
      </div>
    </Drawer>
  )
}
