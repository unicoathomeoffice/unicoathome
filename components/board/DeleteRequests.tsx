'use client'
// Delete unwanted / duplicate requests — a red warning dialog with a required reason. Soft delete on the server
// (lib/services/request-delete.ts): gone from the board, reports and the staff app; kept in the audit log.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { cx } from '@/lib/format'

export type DeleteTarget = { id: string; requestNo: string; patient: string; status: string }

const REASONS = ['Duplicate request', 'Test / wrong entry', 'Patient changed mind before confirming', 'Other']
const ON_VISIT = ['EN_ROUTE', 'IN_PROGRESS']

/** `redirect`: where to go afterwards (the request page itself no longer exists); default: refresh the current page. */
export function DeleteRequestsDialog({ items, onClose, onDone, redirect }: { items: DeleteTarget[]; onClose: () => void; onDone?: () => void; redirect?: string }) {
  const router = useRouter()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const text = [reason === 'Other' ? '' : reason, note.trim()].filter(Boolean).join(' · ')
  const onVisit = items.filter((x) => ON_VISIT.includes(x.status))
  const closed = items.filter((x) => x.status === 'CLOSED' || x.status === 'COMPLETED')
  const many = items.length > 1

  async function go() {
    setBusy(true)
    try {
      const r = await api<{ deleted: string[] }>('/requests/delete', { body: { ids: items.map((x) => x.id), reason: text } })
      toast(`Deleted ${r.deleted.join(', ')}`, 'ok')
      onDone?.()
      onClose()
      if (redirect) router.push(redirect)
      else router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4" role="alertdialog" aria-modal="true" aria-label="Delete requests">
      <div className="absolute inset-0" onClick={() => !busy && onClose()} />
      <div className="relative flex max-h-[88dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-drawer">
        <div className="flex items-center gap-3 border-b border-[#FECACA] bg-[#FEF2F2] px-5 py-4">
          <span className="flex size-10 flex-none items-center justify-center rounded-full bg-[#FEE2E2] text-[#DC2626]">
            <AlertTriangle size={20} />
          </span>
          <div>
            <div className="text-[16px] font-bold leading-snug text-[#991B1B]">{many ? `Delete ${items.length} requests?` : `Delete ${items[0]?.requestNo}?`}</div>
            <div className="text-[12.5px] text-[#B91C1C]">This removes {many ? 'them' : 'it'} for everyone.</div>
          </div>
        </div>
        <div className="flex flex-col gap-3.5 overflow-y-auto px-5 py-4 text-[13.5px]">
          <ul className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2">
            {items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline gap-x-2">
                <b>{x.requestNo}</b>
                <span className="text-slate-600">{x.patient}</span>
                <span className="text-[12px] text-slate-400">· {x.status.replace('_', ' ').toLowerCase()}</span>
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-[#FEE2E2] px-3 py-2.5 text-[13px] leading-5 text-[#991B1B]">
            <b>Warning:</b> {many ? 'these requests disappear' : 'this request disappears'} from the board, reports, the live map and the staff app. Messages that are already sent cannot be recalled; anything still waiting to go out is dropped. Only the audit log keeps a record.
          </div>
          {onVisit.length > 0 && (
            <div className="rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
              {onVisit.map((x) => x.requestNo).join(', ')} {onVisit.length === 1 ? 'is' : 'are'} on a visit right now — cancel {onVisit.length === 1 ? 'it' : 'them'} instead.
            </div>
          )}
          {closed.length > 0 && (
            <div className="rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
              {closed.map((x) => x.requestNo).join(', ')} {closed.length === 1 ? 'was' : 'were'} already visited — deleting also removes {closed.length === 1 ? 'it' : 'them'} from visit counts and billing reports.
            </div>
          )}
          <div>
            <span className="hc-label">
              Reason <span className="text-[#DC2626]">*</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold ring-1', reason === r ? 'bg-[#DC2626] text-white ring-[#DC2626]' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50')}>
                  {r}
                </button>
              ))}
            </div>
            <input className="hc-input mt-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'Other' ? 'Why is it being deleted? (required)' : 'Note (optional)'} />
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 px-5 py-3">
          <button type="button" disabled={busy} onClick={onClose} className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Keep {many ? 'them' : 'it'}
          </button>
          <button type="button" disabled={busy || text.length < 3 || onVisit.length > 0} onClick={go} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 text-sm font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete {many ? `${items.length} requests` : 'request'}
          </button>
        </div>
      </div>
    </div>
  )
}
