'use client'
// Request page → Invoice tab: the visit's hospital bills (uploaded here, or from H360 once connected), payment status
// (Paid / Partially paid / Due / Waived) and sending the bill files on WhatsApp to the patient and care team.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Eye, FileText, Loader2, MessageCircle, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { api, Drawer, useToast, compressImage } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx, taka } from '@/lib/format'

type Invoice = { _id: string; invoiceNo: string; date?: string; total: number; discount?: number; payable: number; paid: number; due: number; attachmentId?: string; source?: 'UPLOAD' | 'H360'; note?: string }
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
}: {
  requestId: string
  billing: { status: string | null; override: string | null; payable: number; paid: number; due: number; invoices: Invoice[]; estimatedFee?: number | null }
  team: Person[]
  patient: { name: string; phone: string; optOut: boolean }
  sent: Sent[]
  canEdit: boolean
  canSend: boolean
  waPaired: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [form, setForm] = useState<null | { edit?: Invoice }>(null)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
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

      {/* invoices */}
      <section className="rounded-card bg-white shadow-card">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-base font-bold">Invoices · {billing.invoices.length}</h2>
          <span className="text-[12px] text-slate-400">Upload the bill from H360 (PDF or photo) and its amounts</span>
        </div>
        {!billing.invoices.length ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <FileText size={24} />
            </span>
            <div className="font-bold">No invoice yet</div>
            <div className="max-w-[420px] text-[13px] text-slate-500">Add the hospital bill for this visit: upload the PDF from H360 (or a photo of it) and enter the amounts. The payment status follows paid vs due.</div>
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
                  const s = inv.due <= 0 ? STATUS.PAID : inv.paid <= 0 ? STATUS.DUE : STATUS.PARTIAL
                  return (
                    <tr key={inv._id} className="border-t border-slate-100">
                      <td className="px-3 py-2.5 font-semibold">
                        {inv.invoiceNo}
                        {inv.source === 'H360' && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">H360</span>}
                      </td>
                      <td className="px-3 py-2.5">{day(inv.date)}</td>
                      <td className="px-3 py-2.5">{taka(inv.total)}</td>
                      <td className="px-3 py-2.5">{inv.discount ? taka(inv.discount) : '—'}</td>
                      <td className="px-3 py-2.5 font-semibold">{taka(inv.payable)}</td>
                      <td className="px-3 py-2.5">{taka(inv.paid)}</td>
                      <td className={cx('px-3 py-2.5', inv.due > 0 && 'font-semibold text-[#B91C1C]')}>{taka(inv.due)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', s.cls)}>{s.label}</span>
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
                          {canEdit && (
                            <>
                              <button type="button" onClick={() => setForm({ edit: inv })} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-primary-700" title="Edit amounts">
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

      {form && <InvoiceForm requestId={requestId} edit={form.edit} onClose={() => setForm(null)} />}
      {sending && <SendDrawer requestId={requestId} invoices={billing.invoices} team={team} patient={patient} waPaired={waPaired} onClose={() => setSending(false)} />}
    </div>
  )
}

function InvoiceForm({ requestId, edit, onClose }: { requestId: string; edit?: Invoice; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [v, setV] = useState({
    invoiceNo: edit?.invoiceNo ?? '',
    date: edit?.date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(edit.date)) : today(),
    total: edit ? String(edit.total) : '',
    discount: edit?.discount ? String(edit.discount) : '',
    paid: edit ? String(edit.paid) : '',
    note: edit?.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const total = num(v.total) ?? 0
  const payable = Math.max(0, total - (num(v.discount) ?? 0))
  const due = Math.max(0, payable - (num(v.paid) ?? 0))
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })

  async function save() {
    if (!v.invoiceNo.trim()) return toast('Enter the invoice no', 'err')
    if (v.total === '') return toast('Enter the total amount', 'err')
    setBusy(true)
    try {
      let attachmentId: string | undefined
      if (file) {
        const form = new FormData()
        form.append('file', file.type.startsWith('image/') ? await compressImage(file, false) : file)
        form.append('kind', 'INVOICE')
        form.append('requestId', requestId)
        form.append('caption', `Invoice ${v.invoiceNo.trim()}`)
        attachmentId = (await api<{ id: string }>('/attachments', { form })).id
      }
      const body = { invoiceNo: v.invoiceNo.trim(), date: v.date, total, discount: num(v.discount) ?? 0, paid: num(v.paid) ?? 0, note: v.note.trim() || undefined, attachmentId }
      if (edit) await api(`/requests/${requestId}/bills/${edit._id}`, { method: 'PATCH', body })
      else await api(`/requests/${requestId}/bills`, { body: { ...body, source: 'UPLOAD' } })
      toast(edit ? `Invoice ${body.invoiceNo} updated` : `Invoice ${body.invoiceNo} added`, 'ok')
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
      title={edit ? `Edit invoice ${edit.invoiceNo}` : 'Add invoice'}
      sub="The bill from H360 — PDF or a clear photo — and its amounts"
      footer={
        <div className="flex justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass('p')} disabled={busy} onClick={save}>
            {busy && <Loader2 size={16} className="animate-spin" />} {edit ? 'Save' : 'Add invoice'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <label className={cx('flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed px-4 py-5 text-center', file ? 'border-primary bg-primary-50/50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100')}>
          <Upload size={20} className="text-primary-700" />
          <span className="text-[14px] font-semibold">{file ? file.name : edit?.attachmentId ? 'Replace the bill file (optional)' : 'Choose the bill file (PDF or photo)'}</span>
          <span className="text-[12px] text-slate-500">PDF, JPG or PNG · up to 4 MB</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="hc-label">Invoice no *</span>
            <input className="hc-input" value={v.invoiceNo} onChange={set('invoiceNo')} placeholder="e.g. 267543" />
          </label>
          <label>
            <span className="hc-label">Date</span>
            <input type="date" className="hc-input" value={v.date} onChange={set('date')} />
          </label>
          <label>
            <span className="hc-label">Total (৳) *</span>
            <input className="hc-input" inputMode="decimal" value={v.total} onChange={set('total')} />
          </label>
          <label>
            <span className="hc-label">Discount (৳)</span>
            <input className="hc-input" inputMode="decimal" value={v.discount} onChange={set('discount')} placeholder="0" />
          </label>
          <label>
            <span className="hc-label">Paid (৳)</span>
            <input className="hc-input" inputMode="decimal" value={v.paid} onChange={set('paid')} placeholder="0" />
          </label>
          <div>
            <span className="hc-label">Payable · Due</span>
            <div className="flex h-10 items-center gap-2 text-[14px]">
              <b>{taka(payable)}</b> · <b className={due > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'}>{due > 0 ? `${taka(due)} due` : 'fully paid'}</b>
            </div>
          </div>
        </div>
        <label>
          <span className="hc-label">Note</span>
          <input className="hc-input" value={v.note} onChange={set('note')} placeholder="e.g. paid by bKash, rest at next visit" />
        </label>
      </div>
    </Drawer>
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

  async function send() {
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
