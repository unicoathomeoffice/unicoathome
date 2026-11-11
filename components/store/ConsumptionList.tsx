'use client'
// Store → Consumption: everything taken out by hand, newest first, with void (puts the stock back) and Excel export.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Loader2, PackageMinus, Pencil, Undo2 } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { ConsumeDrawer, REASONS, type ConsumeItem } from './ConsumeDrawer'

export type ConsumptionRow = {
  id: string
  no: string
  at: string
  reason: string
  items: { itemId: string; name: string; unit: string; qty: number }[]
  requestId: string | null
  patientName: string | null
  note: string
  by: string | null
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
  requestNo: string | null
  edits: { at: string; by: string | null; why: string; before: string; after: string }[]
}

const REASON_LABEL = Object.fromEntries(REASONS) as Record<string, string>
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

export function ConsumptionList({ rows, items, month, reason, canManage }: { rows: ConsumptionRow[]; items: ConsumeItem[]; month: string; reason: string; canManage: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [consume, setConsume] = useState(false)
  const [editing, setEditing] = useState<ConsumptionRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const live = rows.filter((r) => !r.voidedAt)
  const totalQty = live.reduce((a, r) => a + r.items.reduce((b, i) => b + i.qty, 0), 0)

  async function voidIt(r: ConsumptionRow) {
    const why = prompt(`Void ${r.no}? The items go back into the store.\n\nWhy?`)
    if (!why || why.trim().length < 3) return
    setBusy(r.id)
    try {
      await api(`/store/consumptions/${r.id}`, { body: { action: 'void', reason: why.trim() } })
      toast(`${r.no} voided — stock put back`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  /** CSV (opens in Excel) — one row per item */
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [['No', 'Date', 'Item', 'Qty', 'Unit', 'Reason', 'Visit / patient', 'Note', 'By', 'Voided']]
    for (const r of rows) for (const i of r.items) out.push([r.no, when(r.at), i.name, String(i.qty), i.unit, REASON_LABEL[r.reason] ?? r.reason, r.patientName ?? '', r.note, r.by ?? '', r.voidedAt ? `Voided - ${r.voidReason ?? ''}` : ''])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + out.map((row) => row.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `store-consumption-${month || 'all'}.csv`
    a.click()
  }

  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ tab: 'consumption', month, reason, ...patch })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    router.push(`/store?${p}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" className="hc-input w-auto" value={month} onChange={(e) => nav({ month: e.target.value })} aria-label="Month" />
        <select className="hc-input w-auto" value={reason} onChange={(e) => nav({ reason: e.target.value })} aria-label="Reason">
          <option value="">All reasons</option>
          {REASONS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="text-[13px] text-slate-600">
          <b className="text-slate-900">{live.length}</b> entries · <b className="text-slate-900">{totalQty}</b> units taken out
        </span>
        <button type="button" className={btnClass('o', 'md', 'ml-auto')} onClick={exportCsv} disabled={!rows.length}>
          <Download size={16} /> Excel
        </button>
        {canManage && (
          <button type="button" className={btnClass('p')} onClick={() => setConsume(true)}>
            <PackageMinus size={16} /> Consume
          </button>
        )}
      </div>
      {!rows.length ? (
        <div className="rounded-card bg-white px-6 py-12 text-center text-[14px] text-slate-500 shadow-card">No consumption entered by hand{month ? ' this month' : ''}.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.id} className={cx('rounded-card bg-white p-4 shadow-card', r.voidedAt && 'opacity-60')}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <b className={cx('text-[14.5px]', r.voidedAt && 'line-through')}>{r.no}</b>
                <span className="rounded-full bg-slate-100 px-2 text-[12px] font-semibold text-slate-700">{REASON_LABEL[r.reason] ?? r.reason}</span>
                <span className="text-[12.5px] text-slate-500">
                  {when(r.at)}
                  {r.by ? ` · ${r.by}` : ''}
                </span>
                {r.requestId && (
                  <Link href={`/requests/${r.requestId}`} className="text-[12.5px] font-semibold text-primary-700 hover:underline">
                    {r.patientName ?? 'Visit'} ›
                  </Link>
                )}
                {r.voidedAt ? (
                  <span className="ml-auto text-[12px] font-semibold text-[#B91C1C]">
                    Voided {when(r.voidedAt)}
                    {r.voidedBy ? ` · ${r.voidedBy}` : ''}
                    {r.voidReason ? ` · ${r.voidReason}` : ''}
                  </span>
                ) : (
                  canManage && (
                    <span className="ml-auto flex items-center gap-3">
                      <button type="button" onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary-700 hover:underline">
                        <Pencil size={13} /> Edit
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => voidIt(r)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-[#B91C1C]">
                        {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Void
                      </button>
                    </span>
                  )
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.items.map((i) => (
                  <span key={i.itemId} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-slate-50 px-2 text-[12.5px] ring-1 ring-slate-200">
                    {i.name} <b>× {i.qty}</b>
                  </span>
                ))}
              </div>
              {r.note && <div className="mt-1.5 text-[12.5px] text-slate-500">{r.note}</div>}
              {r.edits.length > 0 && (
                <details className="mt-1.5 text-[12px]">
                  <summary className="cursor-pointer font-semibold text-[#B45309]">Edited {r.edits.length}×</summary>
                  <ul className="mt-1 flex flex-col gap-0.5 text-slate-600">
                    {r.edits.map((e, k) => (
                      <li key={k}>
                        {when(e.at)}
                        {e.by ? ` · ${e.by}` : ''} — {e.why}
                        <span className="block text-slate-400">
                          {e.before} → {e.after}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
      {consume && <ConsumeDrawer items={items} onClose={() => setConsume(false)} />}
      {editing && (
        <ConsumeDrawer
          items={items}
          onClose={() => setEditing(null)}
          editing={{ id: editing.id, no: editing.no, items: editing.items.map((i) => ({ itemId: i.itemId, qty: i.qty })), reason: editing.reason, note: editing.note, at: editing.at, requestNo: editing.requestNo }}
        />
      )}
    </div>
  )
}
