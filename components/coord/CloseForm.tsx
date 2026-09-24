'use client'
import { useState } from 'react'
import { Check, AlertTriangle, Loader2 } from 'lucide-react'
import { api, useAction, Segmented } from '@/components/client'
import { taka, cx } from '@/lib/format'
import { FLabel, FixedBottom, bbtn } from './ui'

/** S7 billing reconciliation + close (invoice number, total, print status). Petty cash is decided above it. */
export function CloseForm({ id, requestNo, bill, billStatus, invoiceNo, invoiceAmount, printed, pendingPettyCash, canClose }: { id: string; requestNo: string; bill?: number | null; billStatus?: string; invoiceNo?: string; invoiceAmount?: number | null; printed?: boolean | null; pendingPettyCash: number; canClose: boolean }) {
  const [no, setNo] = useState(invoiceNo ?? '')
  const [amt, setAmt] = useState(invoiceAmount != null ? String(invoiceAmount) : bill != null ? String(bill) : '')
  const [pr, setPr] = useState<'' | 'yes' | 'no'>(printed == null ? '' : printed ? 'yes' : 'no')
  const { run, busy } = useAction()
  const total = amt === '' ? null : Number(amt)
  const match = bill == null || total == null ? null : total === bill
  const ready = no.trim().length > 0 && total != null && pr !== '' && pendingPettyCash === 0 && canClose
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <FLabel req>Invoice number</FLabel>
          <input className="hc-input hc-input-lg" value={no} onChange={(e) => setNo(e.target.value.toUpperCase())} placeholder="INV-…" autoCapitalize="characters" />
        </div>
        <div>
          <FLabel req>Invoice total</FLabel>
          <label className="flex h-12 items-center gap-2 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 focus-within:border-primary">
            <span className="text-slate-400">৳</span>
            <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
          </label>
        </div>
      </div>
      <div>
        <FLabel req>Invoice paper print status</FLabel>
        <Segmented
          h={40}
          value={pr}
          onChange={setPr}
          items={[
            { value: 'yes', label: 'Printed' },
            { value: 'no', label: 'Not printed' },
          ]}
        />
      </div>
      {match != null && (
        <div className={cx('flex items-center gap-1.5 text-[12px] font-semibold', match ? 'text-[#15803D]' : 'text-[#B45309]')}>
          {match ? <Check size={14} strokeWidth={3} /> : <AlertTriangle size={14} />}
          {match ? 'Bill and invoice match' : `Invoice ${taka(total)} differs from the bill ${taka(bill)} collected by staff`}
        </div>
      )}
      <FixedBottom spacer={false} note={pendingPettyCash ? 'Approve or reject the petty cash request first' : !canClose ? 'Only completed visits can be closed' : undefined}>
        <button
          type="button"
          disabled={busy || !ready}
          className={bbtn('g', 'flex-1')}
          onClick={() =>
            run(
              () => api(`/requests/${id}/close`, { body: { invoiceNo: no.trim(), invoiceAmount: total, invoicePrinted: pr === 'yes', billAmount: bill ?? undefined, billingStatus: billStatus === 'PAID' || billStatus === 'DUE' || billStatus === 'WAIVED' ? billStatus : undefined } }),
              `${requestNo} closed`,
              { redirect: `/m/admin/requests/${id}` },
            )
          }
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          Verify report & close
        </button>
      </FixedBottom>
    </>
  )
}
