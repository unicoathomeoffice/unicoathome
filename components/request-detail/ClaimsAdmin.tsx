'use client'
// /claims: staff expense claims — review the lines and receipts, approve / reject, mark paid, resend the forms.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, FileSpreadsheet, FileText, Loader2, Send, Wallet, X } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx, taka } from '@/lib/format'

type Line = { _id: string; kind: string; at?: string; patientName?: string; uhid?: string; from?: string; to?: string; mode?: string; amount: number; receiptIds?: string[] }
type Row = { _id: string; claimNo: string; status: string; total: number; submittedAt?: string; decisionNote?: string; pdfId?: string; xlsxId?: string; user: { name: string; employeeId: string } | null; lines: Line[] }

const TONE: Record<string, string> = { SUBMITTED: 'bg-[#E0F2FE] text-[#0369A1]', APPROVED: 'bg-[#DCFCE7] text-[#15803D]', REJECTED: 'bg-[#FEE2E2] text-[#B91C1C]', PAID: 'bg-slate-900 text-white' }
const TABS: [string, string][] = [
  ['', 'All'],
  ['SUBMITTED', 'To review'],
  ['APPROVED', 'Approved'],
  ['PAID', 'Paid'],
  ['REJECTED', 'Rejected'],
]
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const kindLabel = (k: string) => (k === 'CONVEYANCE' ? 'Travel' : k === 'FOOD' ? 'Food' : 'Other')

export function ClaimsAdmin({ rows, status }: { rows: Row[]; status: string }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function act(id: string, action: string, body: unknown, ok: string) {
    setBusy(`${id}:${action}`)
    try {
      await api(`/claims/${id}/${action}`, { body })
      toast(ok, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  function reject(c: Row) {
    const note = window.prompt('Reason for rejecting this claim?')
    if (note === null) return
    act(c._id, 'decide', { approve: false, note: note || undefined }, `${c.claimNo} rejected`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <Link key={k} href={k ? `/claims?status=${k}` : '/claims'} className={cx('h-9 rounded-full px-4 text-[13.5px] font-semibold leading-9', status === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-card')}>
            {l}
          </Link>
        ))}
      </div>
      <section className="overflow-hidden rounded-card bg-white shadow-card">
        {!rows.length && <div className="p-8 text-center text-[14px] text-slate-500">No claims here yet. Staff submit them from the field app → Profile → My claims.</div>}
        {rows.map((c) => (
          <div key={c._id} className="border-b border-slate-100 last:border-b-0">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button type="button" onClick={() => setOpen(open === c._id ? null : c._id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <ChevronDown size={16} className={cx('flex-none text-slate-400 transition-transform', open === c._id && 'rotate-180')} />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold">
                    {c.user?.name ?? 'Staff'} <span className="font-normal text-slate-500">· {c.user?.employeeId}</span>
                  </span>
                  <span className="block truncate text-[12.5px] text-slate-500">
                    {c.claimNo} · {c.lines.length} item{c.lines.length === 1 ? '' : 's'} · {when(c.submittedAt)}
                  </span>
                </span>
              </button>
              <span className="text-[16px] font-bold">{taka(c.total)}</span>
              <span className={cx('rounded-full px-2.5 py-0.5 text-[11.5px] font-bold', TONE[c.status])}>{c.status.toLowerCase()}</span>
              <div className="flex gap-1">
                {c.pdfId && (
                  <a href={`/api/v1/attachments/${c.pdfId}`} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg text-primary-700 hover:bg-slate-50" title="PDF">
                    <FileText size={16} />
                  </a>
                )}
                {c.xlsxId && (
                  <a href={`/api/v1/attachments/${c.xlsxId}`} className="flex size-8 items-center justify-center rounded-lg text-[#15803D] hover:bg-slate-50" title="Excel">
                    <FileSpreadsheet size={16} />
                  </a>
                )}
                <button type="button" title="Resend to the security supervisor" disabled={busy === `${c._id}:resend`} onClick={() => act(c._id, 'resend', {}, 'Sent again')} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50">
                  {busy === `${c._id}:resend` ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              {c.status === 'SUBMITTED' && (
                <div className="flex gap-1.5">
                  <button type="button" className={btnClass('g', 'sm')} disabled={!!busy} onClick={() => act(c._id, 'decide', { approve: true }, `${c.claimNo} approved`)}>
                    <Check size={14} /> Approve
                  </button>
                  <button type="button" className={btnClass('o', 'sm', 'text-[#B91C1C]')} disabled={!!busy} onClick={() => reject(c)}>
                    <X size={14} /> Reject
                  </button>
                </div>
              )}
              {c.status === 'APPROVED' && (
                <button type="button" className={btnClass('p', 'sm')} disabled={!!busy} onClick={() => act(c._id, 'paid', {}, `${c.claimNo} marked paid`)}>
                  <Wallet size={14} /> Mark paid
                </button>
              )}
            </div>
            {open === c._id && (
              <div className="overflow-x-auto bg-slate-50 px-4 pb-3">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[.06em] text-slate-500">
                      {['Date & time', 'Kind', 'Patient', 'From → To', 'Mode', 'Amount', 'Receipts'].map((h) => (
                        <th key={h} className="px-2 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.lines.map((l) => (
                      <tr key={l._id} className="border-t border-slate-200">
                        <td className="px-2 py-2">{when(l.at)}</td>
                        <td className="px-2 py-2">{kindLabel(l.kind)}</td>
                        <td className="px-2 py-2">
                          {l.patientName}
                          {l.uhid ? <span className="text-slate-500"> · {l.uhid}</span> : null}
                        </td>
                        <td className="px-2 py-2">{[l.from, l.to].filter(Boolean).join(' → ')}</td>
                        <td className="px-2 py-2">{l.mode}</td>
                        <td className="px-2 py-2 font-semibold">{taka(l.amount)}</td>
                        <td className="px-2 py-2">
                          {(l.receiptIds ?? []).map((id, i) => (
                            <a key={id} href={`/api/v1/attachments/${id}`} target="_blank" rel="noreferrer" className="mr-2 text-primary-700 hover:underline">
                              #{i + 1}
                            </a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {c.decisionNote && <div className="mt-2 text-[12.5px] text-slate-600">Note: {c.decisionNote}</div>}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
