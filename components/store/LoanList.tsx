'use client'
// Store → Loans: what we borrowed (we owe it back) and what we lent (they owe us), with returns (partial, item by item),
// write-off, the balance per partner and a printable statement.
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Loader2, Pencil, Printer, RotateCcw, Undo2, XCircle } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import type { LoanRow } from '@/lib/services/store-loans'
import { LoanDrawer } from './LoanDrawer'
import type { PickItem } from './ItemPicker'

type Balance = { partner: string; kind: string; loans: number; overdue: number; weOwe: { name: string; qty: number }[]; theyOwe: { name: string; qty: number }[] }
const when = (iso?: string | null, time = false) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', ...(time ? { hour: 'numeric', minute: '2-digit', hour12: true } : { year: 'numeric' }) }) : '—')
const STATUS: Record<string, [string, string]> = {
  OPEN: ['Open', 'bg-[#E0E7FF] text-[#4338CA]'],
  PARTLY_RETURNED: ['Part returned', 'bg-[#FEF3C7] text-[#B45309]'],
  RETURNED: ['Returned', 'bg-[#DCFCE7] text-[#15803D]'],
  WRITTEN_OFF: ['Written off', 'bg-slate-100 text-slate-600'],
}

export function LoanList({ rows, balances, items, filter, canManage }: { rows: LoanRow[]; balances: Balance[]; items: PickItem[]; filter: { status: string; direction: string; partner: string }; canManage: boolean }) {
  const router = useRouter()
  const [loan, setLoan] = useState<null | 'TAKEN' | 'GIVEN'>(null)
  const [ret, setRet] = useState<LoanRow | null>(null)
  const [editing, setEditing] = useState<LoanRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  async function reopen(r: LoanRow) {
    const why = prompt(`Re-open ${r.no}? Use this when written-off items turn up after all.\n\nWhy?`)
    if (!why || why.trim().length < 3) return
    setBusy(r.id)
    try {
      await api(`/store/loans/${r.id}`, { body: { action: 'reopen', reason: why.trim() } })
      toast(`${r.no} re-opened`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ tab: 'loans', ...filter, ...patch })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    router.push(`/store?${p}`)
  }

  function statement(b: Balance) {
    const list = rows.filter((r) => r.partner.name === b.partner)
    const h = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!)
    const body = list
      .map((r) => `<tr><td>${h(r.no)}</td><td>${h(when(r.at))}</td><td>${r.direction === 'TAKEN' ? 'We borrowed' : 'We lent'}</td><td>${r.items.map((i) => `${h(i.name)} × ${i.qty}${i.returnedQty ? ` (back ${i.returnedQty})` : ''}`).join('<br>')}</td><td>${h(when(r.dueAt))}</td><td>${h(STATUS[r.status]?.[0])}</td></tr>`)
      .join('')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(
      `<!doctype html><meta charset="utf-8"><title>Loan statement · ${h(b.partner)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}h1{font-size:17px;margin:0}p{color:#555;margin:2px 0 12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}</style><h1>Loan statement · ${h(b.partner)}</h1><p>Unico HomeCare store · Nursing Services – Family Medicine · ${h(when(new Date().toISOString(), true))}</p><p><b>We owe them:</b> ${b.weOwe.map((x) => `${h(x.name)} × ${x.qty}`).join(', ') || 'nothing'}<br><b>They owe us:</b> ${b.theyOwe.map((x) => `${h(x.name)} × ${x.qty}`).join(', ') || 'nothing'}</p><table><tr><th>No</th><th>Date</th><th>Type</th><th>Items</th><th>Due</th><th>Status</th></tr>${body}</table><p style="margin-top:28px">Store ____________________ &nbsp;&nbsp; ${h(b.partner)} ____________________</p><script>print()</script>`,
    )
    w.document.close()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* balance per partner */}
      {balances.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {balances.map((b) => (
            <div key={b.partner} className="rounded-card bg-white p-3.5 shadow-card">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => nav({ partner: filter.partner === b.partner ? '' : b.partner })} className="min-w-0 flex-1 truncate text-left text-[14.5px] font-bold hover:text-primary-700">
                  {b.partner}
                </button>
                {b.overdue > 0 && <span className="rounded bg-[#FEE2E2] px-1.5 text-[11px] font-bold text-[#B91C1C]">{b.overdue} overdue</span>}
                <button type="button" onClick={() => statement(b)} className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="Print statement">
                  <Printer size={15} />
                </button>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2 text-[12.5px]">
                <div>
                  <div className="font-semibold text-[#4338CA]">We owe them</div>
                  {b.weOwe.length ? b.weOwe.map((x) => <div key={x.name} className="truncate">{x.name} <b>× {x.qty}</b></div>) : <div className="text-slate-400">nothing</div>}
                </div>
                <div>
                  <div className="font-semibold text-[#B45309]">They owe us</div>
                  {b.theyOwe.length ? b.theyOwe.map((x) => <div key={x.name} className="truncate">{x.name} <b>× {x.qty}</b></div>) : <div className="text-slate-400">nothing</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['open', 'Open'],
          ['overdue', 'Overdue'],
          ['closed', 'Returned / written off'],
          ['', 'All'],
        ] as const).map(([k, l]) => (
          <button key={l} type="button" onClick={() => nav({ status: k })} className={cx('h-9 rounded-full px-3 text-[13px] font-semibold', filter.status === k ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
            {l}
          </button>
        ))}
        <select className="hc-input h-9 w-auto" value={filter.direction} onChange={(e) => nav({ direction: e.target.value })} aria-label="Direction">
          <option value="">Borrowed and lent</option>
          <option value="TAKEN">We borrowed</option>
          <option value="GIVEN">We lent</option>
        </select>
        {filter.partner && (
          <button type="button" className="text-[12.5px] font-semibold text-primary-700" onClick={() => nav({ partner: '' })}>
            {filter.partner} ×
          </button>
        )}
        {canManage && (
          <span className="ml-auto flex gap-2">
            <button type="button" className={btnClass('o')} onClick={() => setLoan('TAKEN')}>
              <ArrowDownLeft size={16} /> Take loan
            </button>
            <button type="button" className={btnClass('p')} onClick={() => setLoan('GIVEN')}>
              <ArrowUpRight size={16} /> Give loan
            </button>
          </span>
        )}
      </div>

      {!rows.length ? (
        <div className="rounded-card bg-white px-6 py-12 text-center text-[14px] text-slate-500 shadow-card">No loans here.</div>
      ) : (
        <div className="overflow-x-auto rounded-card bg-white shadow-card">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11.5px] uppercase tracking-[.04em] text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Loan</th>
                <th className="px-2 py-2.5">With</th>
                <th className="px-2 py-2.5">Items · outstanding</th>
                <th className="px-2 py-2.5">Due</th>
                <th className="px-2 py-2.5">Status</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = r.status === 'OPEN' || r.status === 'PARTLY_RETURNED'
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 font-bold">
                          {r.direction === 'TAKEN' ? <ArrowDownLeft size={14} className="text-[#4338CA]" /> : <ArrowUpRight size={14} className="text-[#B45309]" />}
                          {r.no}
                        </div>
                        <div className="text-[11.5px] text-slate-500">
                          {r.direction === 'TAKEN' ? 'Borrowed' : 'Lent'} {when(r.at, true)}
                          {r.by ? ` · ${r.by}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="font-semibold">{r.partner.name}</div>
                        <div className="text-[11.5px] text-slate-500">
                          {{ DEPARTMENT: 'Department', STAFF: 'Staff', OUTSIDE: 'Outside' }[r.partner.kind] ?? r.partner.kind}
                          {r.partner.phone ? ` · ${r.partner.phone}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        {r.items.map((i) => (
                          <div key={i.itemId}>
                            {i.name} <b>× {i.qty}</b>
                            {i.returnedQty > 0 && <span className="text-[#15803D]"> · back {i.returnedQty}</span>}
                            {open && i.outstanding > 0 && <span className="font-semibold text-[#B45309]"> · {i.outstanding} out</span>}
                          </div>
                        ))}
                        {r.note && <div className="text-[11.5px] text-slate-500">{r.note}</div>}
                        {r.requestId && (
                          <Link href={`/requests/${r.requestId}`} className="text-[11.5px] font-semibold text-primary-700 hover:underline">
                            Visit ›
                          </Link>
                        )}
                      </td>
                      <td className={cx('px-2 py-2.5 whitespace-nowrap', r.overdue && 'font-bold text-[#B91C1C]')}>
                        {r.overdue && <AlertTriangle size={13} className="mr-1 inline" />}
                        {when(r.dueAt)}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', STATUS[r.status]?.[1])}>{STATUS[r.status]?.[0] ?? r.status}</span>
                        {r.writeOffReason && <div className="mt-0.5 text-[11.5px] text-slate-500">{r.writeOffReason}</div>}
                        {r.edits.length > 0 && (
                          <details className="mt-1 text-[11.5px]">
                            <summary className="cursor-pointer font-semibold text-[#B45309]">Edited {r.edits.length}×</summary>
                            <ul className="mt-0.5 text-slate-600">
                              {r.edits.map((e, k) => (
                                <li key={k}>
                                  {when(e.at, true)}
                                  {e.by ? ` · ${e.by}` : ''} — {e.why}
                                  <span className="block text-slate-400">{e.summary}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          {open && canManage && (
                            <button type="button" className={btnClass('o', 'sm')} onClick={() => setRet(r)}>
                              <Undo2 size={14} /> {r.direction === 'TAKEN' ? 'Give back' : 'Returned'}
                            </button>
                          )}
                          {canManage && r.status !== 'WRITTEN_OFF' && (
                            <span className="flex gap-3">
                              <button type="button" onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary-700 hover:underline">
                                <Pencil size={13} /> Edit
                              </button>
                              {r.returns.some((x) => !x.undone) && (
                                <button type="button" onClick={() => setRet(r)} className="text-[12.5px] font-semibold text-slate-500 hover:underline">
                                  Returns
                                </button>
                              )}
                            </span>
                          )}
                          {canManage && r.status === 'WRITTEN_OFF' && (
                            <button type="button" disabled={busy === r.id} onClick={() => reopen(r)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary-700 hover:underline">
                              {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Re-open
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {loan && <LoanDrawer direction={loan} items={items} onClose={() => setLoan(null)} />}
      {ret && <ReturnDrawer loan={ret} onClose={() => setRet(null)} />}
      {editing && (
        <LoanDrawer
          direction={editing.direction}
          items={items}
          onClose={() => setEditing(null)}
          editing={{ id: editing.id, no: editing.no, direction: editing.direction, partner: editing.partner, items: editing.items.map((i) => ({ itemId: i.itemId, qty: i.qty, returnedQty: i.returnedQty })), dueAt: editing.dueAt, note: editing.note, requestNo: editing.requestNo ?? null }}
        />
      )}
    </div>
  )
}

/** Record what came back (or what we gave back), item by item — or write the rest off. */
function ReturnDrawer({ loan, onClose }: { loan: LoanRow; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(loan.items.map((i) => [i.itemId, String(i.outstanding)])))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'return' | 'writeoff'>(null)
  const taken = loan.direction === 'TAKEN'
  async function undo(index: number) {
    const why = prompt('Undo this return? The items count as still out again.\n\nWhy?')
    if (!why || why.trim().length < 3) return
    setBusy('return')
    try {
      await api(`/store/loans/${loan.id}`, { body: { action: 'undo-return', index, reason: why.trim() } })
      toast('Return undone', 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function go(action: 'return' | 'writeoff') {
    let body: Record<string, unknown>
    if (action === 'writeoff') {
      const why = prompt(`Write off what is still out on ${loan.no}? It will not come back.\n\nWhy?`)
      if (!why || why.trim().length < 3) return
      body = { action, reason: why.trim() }
    } else body = { action, items: loan.items.map((i) => ({ itemId: i.itemId, qty: Number(qty[i.itemId]) || 0 })), note: note.trim() || undefined }
    setBusy(action)
    try {
      const r = await api<{ status: string }>(`/store/loans/${loan.id}`, { body })
      toast(action === 'writeoff' ? `${loan.no} written off` : r.status === 'RETURNED' ? `${loan.no} fully returned` : `${loan.no} partly returned`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title={taken ? `Give back · ${loan.no}` : `Returned · ${loan.no}`}
      sub={`${taken ? 'Borrowed from' : 'Lent to'} ${loan.partner.name} · ${taken ? 'stock goes down' : 'stock comes back up'}`}
      width={480}
      footer={
        <>
          <button type="button" className={btnClass('ghost', 'md', 'mr-auto text-[#B91C1C]')} disabled={!!busy} onClick={() => go('writeoff')}>
            {busy === 'writeoff' ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Write off
          </button>
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass('p')} disabled={!!busy} onClick={() => go('return')}>
            {busy === 'return' ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />} Save return
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {loan.items.map((i) => (
          <div key={i.itemId} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{i.name}</div>
              <div className="text-[12px] text-slate-500">
                {i.qty} {i.unit} · back {i.returnedQty} · <b className="text-[#B45309]">{i.outstanding} out</b>
              </div>
            </div>
            <input className="hc-input h-9 w-20 text-center" inputMode="numeric" disabled={!i.outstanding} value={qty[i.itemId] ?? '0'} onChange={(e) => setQty({ ...qty, [i.itemId]: String(Math.min(i.outstanding, Number(e.target.value.replace(/\D/g, '')) || 0)) })} aria-label={`${i.name} returned now`} />
          </div>
        ))}
        <label>
          <span className="hc-label">Note</span>
          <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. returned by Sister Rina" />
        </label>
        {loan.returns.length > 0 && (
          <div>
            <div className="mb-1 text-[12px] font-semibold text-slate-600">Returns so far</div>
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {loan.returns.map((x) => (
                <li key={x.index} className={cx('flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5', x.undone && 'opacity-60')}>
                  <span className="min-w-0 flex-1">
                    <span className={cx(x.undone && 'line-through')}>
                      {when(x.at, true)} · {x.items.map((y) => `${y.name} × ${y.qty}`).join(', ')}
                    </span>
                    {x.by ? <span className="text-slate-500"> · {x.by}</span> : null}
                    {x.undone && <span className="block text-[11.5px] text-[#B91C1C]">Undone — {x.undoReason}</span>}
                  </span>
                  {!x.undone && (
                    <button type="button" disabled={!!busy} onClick={() => undo(x.index)} className="flex-none text-[12px] font-semibold text-[#B91C1C] hover:underline">
                      Undo
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  )
}
