'use client'
// Store → Movements: every change of stock (opening, received, visits, consumed by hand, loans, counts) in one ledger,
// filtered by item, kind and dates, with the balance after each move and a CSV export.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, Loader2 } from 'lucide-react'
import { api } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Move = { id: string; at: string; itemId: string; item: string; unit: string; delta: number; balance: number | null; reason: string; note: string; by: string | null; requestId: string | null; requestNo: string | null; patient: string | null }
const REASONS: [string, string][] = [
  ['', 'All kinds'],
  ['VISIT', 'Used on visits'],
  ['MANUAL', 'Consumed by hand'],
  ['RECEIVED', 'Received'],
  ['LOAN', 'Loans'],
  ['ADJUST', 'Stock counts / matches'],
  ['OPENING', 'Opening stock'],
]
const LABEL: Record<string, string> = { OPENING: 'Opening', RECEIVED: 'Received', VISIT: 'Visit', ADJUST: 'Count / match', MANUAL: 'Consumed', LOAN_IN: 'Borrowed', LOAN_OUT: 'Lent', LOAN_RETURN_IN: 'Loan back', LOAN_RETURN_OUT: 'Given back' }
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true })

export function MovesList({ items }: { items: { _id: string; name: string }[] }) {
  const [f, setF] = useState({ itemId: '', reason: '', from: '', to: '' })
  const [rows, setRows] = useState<Move[] | null>(null)
  useEffect(() => {
    setRows(null)
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v))
    api<{ items: Move[] }>(`/store/moves?${p}`)
      .then((r) => setRows(r.items))
      .catch(() => setRows([]))
  }, [f])
  const inQty = (rows ?? []).filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0)
  const outQty = (rows ?? []).filter((m) => m.delta < 0).reduce((a, m) => a - m.delta, 0)

  function csv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [['Date', 'Item', 'Unit', 'In', 'Out', 'Balance', 'Kind', 'Note', 'Visit', 'By']]
    for (const m of rows ?? []) out.push([when(m.at), m.item, m.unit, m.delta > 0 ? String(m.delta) : '', m.delta < 0 ? String(-m.delta) : '', String(m.balance ?? ''), LABEL[m.reason] ?? m.reason, m.note, m.patient ? `${m.patient} ${m.requestNo ?? ''}` : '', m.by ?? ''])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + out.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `store-movements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="hc-label">Item</span>
          <select className="hc-input" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            <option value="">All items</option>
            {items.map((i) => (
              <option key={i._id} value={i._id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="hc-label">Kind</span>
          <select className="hc-input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {REASONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="hc-label">From</span>
          <input type="date" className="hc-input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label>
          <span className="hc-label">To</span>
          <input type="date" className="hc-input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <button type="button" className={btnClass('o', 'md')} onClick={csv} disabled={!rows?.length}>
          <Download size={16} /> CSV
        </button>
      </div>
      {rows && (
        <div className="text-[13px] text-slate-600">
          {rows.length} moves · <b className="text-[#15803D]">+{inQty}</b> in · <b className="text-[#B91C1C]">−{outQty}</b> out{rows.length === 500 ? ' · showing the latest 500 — narrow the filter' : ''}
        </div>
      )}
      {!rows ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : !rows.length ? (
        <div className="rounded-card bg-white px-6 py-12 text-center text-[14px] text-slate-500 shadow-card">No moves for this filter.</div>
      ) : (
        <div className="overflow-x-auto rounded-card bg-white shadow-card">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11.5px] uppercase tracking-[.04em] text-slate-500">
              <tr>
                <th className="px-3 py-2.5">When</th>
                <th className="px-2 py-2.5">Item</th>
                <th className="px-2 py-2.5 text-right">In / out</th>
                <th className="px-2 py-2.5 text-right">Balance</th>
                <th className="px-2 py-2.5">Kind</th>
                <th className="px-2 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{when(m.at)}</td>
                  <td className="max-w-[260px] truncate px-2 py-2 font-semibold" title={m.item}>
                    {m.item}
                  </td>
                  <td className={cx('px-2 py-2 text-right font-bold tabular-nums', m.delta < 0 ? 'text-[#B91C1C]' : 'text-[#15803D]')}>
                    {m.delta > 0 ? '+' : ''}
                    {m.delta}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{m.balance ?? '—'}</td>
                  <td className="px-2 py-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-700">{LABEL[m.reason] ?? m.reason}</span>
                  </td>
                  <td className="max-w-[340px] px-2 py-2 text-[12.5px] text-slate-600">
                    <span className="line-clamp-2">{m.note}</span>
                    {m.requestId && (
                      <Link href={`/requests/${m.requestId}`} className="font-semibold text-primary-700 hover:underline">
                        {m.patient ?? m.requestNo} ›
                      </Link>
                    )}
                    {m.by && <span className="text-slate-400"> · {m.by}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
