'use client'
// Store → H360 match: the Family Medicine store in HomeCare against H360's Sub Store Stock Ledger, item by item.
// Every difference is explained (used here but not yet consumed in H360, consumed / received only in H360, counts here,
// unexplained), valued in ৳ and followed up (match, mark consumed, received, add, accept with a reason, give to someone).
// H360 is only read — consumption is entered there by staff, using the "To consume in H360" sheet.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardList, Download, Loader2, PackagePlus, Printer, RefreshCw, Scale, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import type { Compare, CompareRow, Kind } from '@/lib/services/store-sync'

type Trend = { day: string; differences: number; unexplained: number; value: number; toConsume: number }
type Filter = 'DIFF' | 'CONSUME' | 'UNEXPLAINED' | 'ONLY_H360' | 'ONLY_LOCAL' | 'MATCH' | 'ALL'

const KIND: Record<Kind, { label: string; tone: string }> = {
  MATCH: { label: 'Match', tone: 'bg-[#DCFCE7] text-[#15803D]' },
  TO_CONSUME: { label: 'Used here · not yet in H360', tone: 'bg-[#FEF3C7] text-[#B45309]' },
  H360_LOWER: { label: 'H360 lower', tone: 'bg-[#FEE2E2] text-[#B91C1C]' },
  H360_HIGHER: { label: 'H360 higher', tone: 'bg-[#E0E7FF] text-[#4338CA]' },
  ONLY_H360: { label: 'Only in H360', tone: 'bg-[#EDE9FE] text-[#6D28D9]' },
  ONLY_LOCAL: { label: 'Only in HomeCare', tone: 'bg-slate-100 text-slate-600' },
}
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—')
const taka = (n: number) => `৳${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

/** one line saying why HomeCare and H360 differ */
function why(r: CompareRow) {
  if (r.kind === 'MATCH') return 'Same in both'
  if (r.kind === 'ONLY_H360') return 'In the H360 store, not in HomeCare yet'
  if (r.kind === 'ONLY_LOCAL') return r.code ? `Code ${r.code} is not in the H360 Family Medicine store` : 'No H360 code — link it'
  const parts: string[] = []
  if (r.toConsume) parts.push(`${r.toConsume} used here, not yet consumed in H360`)
  if (r.consumedOnlyInH360) parts.push(`${r.consumedOnlyInH360} consumed in H360, not recorded here`)
  if (r.receivedOnlyInH360) parts.push(`${r.receivedOnlyInH360} received in H360, not here`)
  if (r.receivedHere - (r.inH360 ?? 0) > 0) parts.push(`${r.receivedHere - (r.inH360 ?? 0)} received here, not in H360`)
  if (r.countedHere) parts.push(`stock count here ${sign(r.countedHere)}`)
  if (r.loansHere) parts.push(r.loansHere < 0 ? `${-r.loansHere} lent out (loan)` : `${r.loansHere} borrowed (loan)`)
  if (r.unexplained) parts.push(`${Math.abs(r.unexplained)} unexplained`)
  if (r.outH360 == null && !parts.length) parts.push('H360 history not read')
  return parts.join(' · ') || 'Different'
}

export function StoreReconcile({ staff }: { staff: { id: string; name: string }[] }) {
  const router = useRouter()
  const toast = useToast()
  const [data, setData] = useState<{ compare: Compare; trend: Trend[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('DIFF')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api<{ compare?: Compare; trend?: Trend[]; error?: string }>('/store/h360')
      if (r.error) setErr(r.error)
      else setData({ compare: r.compare!, trend: r.trend ?? [] })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const c = data?.compare
  const rows = useMemo(() => {
    if (!c) return []
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return c.rows
      .filter((r) =>
        filter === 'ALL' ? true : filter === 'DIFF' ? r.kind !== 'MATCH' : filter === 'CONSUME' ? r.toConsume > 0 : filter === 'UNEXPLAINED' ? !!r.unexplained : r.kind === filter,
      )
      .filter((r) => words.every((w) => [r.name, r.code, r.family, r.variant, r.brand].some((f) => (f ?? '').toLowerCase().includes(w))))
      .sort((a, b) => b.value - a.value || Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name))
  }, [c, filter, q])

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(JSON.stringify(body))
    try {
      const r = await api<{ done?: string[]; still?: string[]; added?: string[] }>('/store/h360', { body })
      if (r.still?.length) toast(`Not changed: ${r.still.join('; ')}`, 'err')
      if (r.done?.length || r.added?.length || (!r.still?.length && !r.done)) toast(ok, 'ok')
      setSel(new Set())
      await load()
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const ids = (list: CompareRow[]) => list.map((r) => r.itemId).filter(Boolean) as string[]
  const chosen = rows.filter((r) => sel.has(r.key))

  function exportCsv() {
    if (!c) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [['Code', 'Item', 'Family', 'Size', 'Company', 'Unit', 'H360', 'HomeCare', 'Difference', 'Value (BDT)', 'Status', 'Why', 'Follow-up']]
    for (const r of rows) out.push([r.code ?? '', r.name, r.family ?? '', r.variant ?? '', r.brand ?? '', r.unit, String(r.h360 ?? ''), String(r.local ?? ''), String(r.diff), String(r.value), KIND[r.kind].label, why(r), r.issue ? `${r.issue.status}${r.issue.assignedTo ? ` · ${r.issue.assignedTo}` : ''}${r.issue.acceptedReason ? ` · ${r.issue.acceptedReason}` : ''}` : ''])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + out.map((x) => x.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `store-vs-h360-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  /** a printable sheet in a new window: "to consume in H360" (with visits) or a stock-take count sheet */
  function printSheet(kind: 'consume' | 'count') {
    if (!c) return
    const list = kind === 'consume' ? c.rows.filter((r) => r.toConsume > 0) : c.rows.filter((r) => r.kind !== 'ONLY_H360').sort((a, b) => (a.family ?? a.name).localeCompare(b.family ?? b.name))
    const h = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!)
    const body =
      kind === 'consume'
        ? list
            .map(
              (r) =>
                `<tr><td>${h(r.code)}</td><td><b>${h(r.name)}</b><div class="s">${r.usage
                  .map((u) => `${h(new Date(u.at).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' }))} · ${u.qty} · ${h(u.what === 'Visit' ? `${u.patient ?? ''} ${u.requestNo ?? ''}` : `By hand ${u.ref ?? ''}`)}`)
                  .join('<br>')}</div></td><td class="n">${r.toConsume}</td><td>${h(r.unit)}</td><td></td></tr>`,
            )
            .join('')
        : list.map((r) => `<tr><td>${h(r.code)}</td><td><b>${h(r.name)}</b></td><td>${h(r.unit)}</td><td class="n">${r.h360 ?? ''}</td><td class="n">${r.local ?? ''}</td><td class="box"></td></tr>`).join('')
    const head = kind === 'consume' ? '<tr><th>Code</th><th>Item · used on</th><th>Qty</th><th>Unit</th><th>Entered in H360 ✓</th></tr>' : '<tr><th>Code</th><th>Item</th><th>Unit</th><th>H360</th><th>HomeCare</th><th>Counted</th></tr>'
    const title = kind === 'consume' ? 'To consume in H360 — Department Consumption' : 'Stock-take sheet'
    const w = window.open('', '_blank')
    if (!w) return toast('Allow pop-ups to print', 'err')
    w.document.write(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:12px system-ui,sans-serif;margin:24px}h1{font-size:17px;margin:0}p{color:#555;margin:2px 0 12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}.n{text-align:right;font-weight:700}.s{color:#555;font-size:11px;margin-top:2px}.box{width:80px}</style><h1>${title}</h1><p>${h(c.storeName)} · ${h(when(c.at))} · ${list.length} items</p><table>${head}${body}</table><p style="margin-top:28px">Prepared by ____________________ &nbsp;&nbsp; Checked by ____________________</p><script>print()</script>`,
    )
    w.document.close()
  }

  if (loading && !data)
    return (
      <div className="flex items-center gap-2 rounded-card bg-white px-5 py-10 text-[14px] text-slate-500 shadow-card">
        <Loader2 size={18} className="animate-spin" /> Reading the Family Medicine store in H360 and comparing…
      </div>
    )
  if (err && !data)
    return (
      <div className="rounded-card bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 font-semibold text-[#B91C1C]">
          <AlertTriangle size={17} /> H360 could not be read: {err}
        </div>
        <div className="mt-1 text-[13px] text-slate-500">
          Check the H360 store login in{' '}
          <Link href="/settings#h360" className="font-semibold text-primary-700 hover:underline">
            Settings → Integrations
          </Link>
          .
        </div>
        <button type="button" className={btnClass('o', 'md', 'mt-3')} onClick={load}>
          <RefreshCw size={16} /> Try again
        </button>
      </div>
    )
  if (!c) return null
  const maxD = Math.max(1, ...(data?.trend ?? []).map((t) => t.differences))

  const tabs: [Filter, string, number][] = [
    ['DIFF', 'Differences', c.counts.differences],
    ['CONSUME', 'To consume in H360', c.rows.filter((r) => r.toConsume > 0).length],
    ['UNEXPLAINED', 'Unexplained', c.counts.unexplained],
    ['ONLY_H360', 'Only in H360', c.counts.ONLY_H360],
    ['ONLY_LOCAL', 'Only in HomeCare', c.counts.ONLY_LOCAL],
    ['MATCH', 'Matched', c.counts.MATCH],
    ['ALL', 'All', c.rows.length],
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* summary */}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-card bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold">{c.storeName}</div>
              <div className="text-[12.5px] text-slate-500">Compared {when(c.at)} · checks again every 30 minutes</div>
            </div>
            <button type="button" className={btnClass('o', 'md')} disabled={loading} onClick={load}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Compare now
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['H360 total', c.h360Total.toLocaleString('en-US'), ''],
              ['HomeCare total', c.localTotal.toLocaleString('en-US'), ''],
              ['Differences', String(c.counts.differences), c.counts.differences ? 'text-[#B45309]' : 'text-[#15803D]'],
              ['Out of balance', taka(c.counts.value), c.counts.value ? 'text-[#B91C1C]' : 'text-[#15803D]'],
            ].map(([k, v, tone]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-slate-500">{k}</div>
                <div className={cx('text-[22px] font-bold', tone)}>{v}</div>
              </div>
            ))}
          </div>
          {c.counts.differences === 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#F0FDF4] px-3 py-2 text-[13.5px] font-semibold text-[#15803D]">
              <CheckCircle2 size={16} /> All {c.counts.MATCH} items match H360
            </div>
          )}
        </div>
        <div className="rounded-card bg-white p-4 shadow-card">
          <div className="text-[13px] font-bold">Differences · last 30 days</div>
          {(data?.trend ?? []).length < 2 ? (
            <div className="mt-6 text-center text-[12.5px] text-slate-400">The trend fills in as comparisons run</div>
          ) : (
            <div className="mt-3 flex h-[92px] items-end gap-1">
              {data!.trend.map((t) => (
                <div key={t.day} className="flex h-full flex-1 flex-col justify-end" title={`${t.day}: ${t.differences} differences · ${t.unexplained} unexplained · ${taka(t.value)}`}>
                  <div className="w-full rounded-t bg-[#FCD34D]" style={{ height: `${Math.max(2, (t.differences / maxD) * 100)}%` }}>
                    <div className="w-full rounded-t bg-[#DC2626]" style={{ height: `${t.differences ? (t.unexplained / t.differences) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-[#FCD34D]" /> differences
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-[#DC2626]" /> unexplained
            </span>
          </div>
        </div>
      </div>

      {/* filters + bulk */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {tabs.map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => (setFilter(k), setSel(new Set()))} className={cx('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold', filter === k ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
              {label} <span className={cx('rounded-full px-1.5 text-[11px]', filter === k ? 'bg-white/20' : 'bg-slate-100')}>{n}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="hc-input h-9 pl-8" placeholder="Item, size, company, code" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chosen.length > 0 ? (
          <>
            <span className="text-[13px] font-semibold">{chosen.length} selected</span>
            <button type="button" disabled={!!busy} className={btnClass('o', 'sm')} onClick={() => confirm(`Set ${chosen.length} item(s) in HomeCare to the H360 count?`) && act({ action: 'match', itemIds: ids(chosen) }, 'Matched to H360')}>
              <Scale size={14} /> Match to H360
            </button>
            <button type="button" disabled={!!busy} className={btnClass('o', 'sm')} onClick={() => act({ action: 'consumed', itemIds: ids(chosen) }, 'Checked — consumed in H360')}>
              <ClipboardList size={14} /> Consumed in H360 ✓
            </button>
            {chosen.some((r) => r.kind === 'ONLY_H360') && (
              <button type="button" disabled={!!busy} className={btnClass('o', 'sm')} onClick={() => act({ action: 'add', codes: chosen.filter((r) => r.kind === 'ONLY_H360').map((r) => r.code) }, 'Added to the store')}>
                <PackagePlus size={14} /> Add to store
              </button>
            )}
          </>
        ) : (
          <span className="text-[12.5px] text-slate-500">Tick rows for bulk actions. Biggest ৳ first.</span>
        )}
        <span className="ml-auto flex gap-2">
          <button type="button" className={btnClass('o', 'sm')} onClick={() => printSheet('consume')}>
            <Printer size={14} /> To-consume sheet
          </button>
          <button type="button" className={btnClass('o', 'sm')} onClick={() => printSheet('count')}>
            <Printer size={14} /> Stock-take sheet
          </button>
          <button type="button" className={btnClass('o', 'sm')} onClick={exportCsv}>
            <Download size={14} /> CSV
          </button>
        </span>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-card bg-white shadow-card">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11.5px] uppercase tracking-[.04em] text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2.5">
                <input type="checkbox" className="size-4 accent-[#0090CA]" checked={!!rows.length && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} aria-label="Select all" />
              </th>
              <th className="px-2 py-2.5">Item</th>
              <th className="px-2 py-2.5 text-right">H360</th>
              <th className="px-2 py-2.5 text-right">HomeCare</th>
              <th className="px-2 py-2.5 text-right">Diff</th>
              <th className="px-2 py-2.5 text-right">৳</th>
              <th className="px-2 py-2.5">Why</th>
              <th className="px-2 py-2.5">Follow-up</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  {filter === 'DIFF' ? 'No differences — HomeCare and H360 agree.' : 'Nothing here.'}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = open === r.key
              const accepted = r.issue?.status === 'ACCEPTED'
              return (
                <Fragment key={r.key}>
                  <tr className={cx('border-b border-slate-100 align-top', accepted && 'opacity-60', isOpen && 'bg-slate-50')}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" className="size-4 accent-[#0090CA]" checked={sel.has(r.key)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n })} aria-label={`Select ${r.name}`} />
                    </td>
                    <td className="max-w-[300px] px-2 py-2.5">
                      <div className="truncate font-semibold text-slate-900" title={r.name}>
                        {r.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
                        <span className={cx('rounded px-1.5 py-px font-semibold', KIND[r.kind].tone)}>{KIND[r.kind].label}</span>
                        {r.code && <span>{r.code}</span>}
                        {r.brand && <span>· {r.brand}</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{r.h360 ?? '—'}</td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{r.local ?? '—'}</td>
                    <td className={cx('px-2 py-2.5 text-right font-bold tabular-nums', r.diff < 0 ? 'text-[#B45309]' : r.diff > 0 ? 'text-[#B91C1C]' : 'text-slate-400')}>{r.kind === 'MATCH' ? '0' : sign(r.diff)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{r.value ? taka(r.value) : '—'}</td>
                    <td className="max-w-[280px] px-2 py-2.5 text-[12.5px] text-slate-600">
                      {why(r)}
                      {!!r.unexplained && <span className="ml-1 rounded bg-[#FEE2E2] px-1 text-[11px] font-bold text-[#B91C1C]">check</span>}
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-slate-500">
                      {r.issue ? (
                        <>
                          <span className="font-semibold text-slate-700">{r.issue.status === 'IN_PROGRESS' ? 'In progress' : r.issue.status === 'ACCEPTED' ? 'Accepted' : 'Open'}</span>
                          {r.issue.assignedTo && ` · ${r.issue.assignedTo}`}
                          <div>since {when(r.issue.since)}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <button type="button" onClick={() => setOpen(isOpen ? null : r.key)} className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Details">
                        <ChevronDown size={16} className={cx('transition-transform', isOpen && 'rotate-180')} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <td colSpan={9} className="px-5 pb-4 pt-1">
                        <RowDetail r={r} staff={staff} busy={!!busy} act={act} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RowDetail({ r, staff, busy, act }: { r: CompareRow; staff: { id: string; name: string }[]; busy: boolean; act: (body: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('7')
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [code, setCode] = useState('')
  const [tol, setTol] = useState(String(r.tolerance))
  const target = r.itemId ? { itemId: r.itemId } : { code: r.code }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
      <div>
        <div className="mb-1 text-[12px] font-bold uppercase tracking-[.04em] text-slate-500">Since {when(r.syncedAt)}</div>
        <table className="w-full text-[12.5px]">
          <tbody>
            {[
              ['Used here (visits + by hand)', r.usedHere],
              ['Received here', r.receivedHere],
              ['Stock counts here', r.countedHere],
              ['Loans (+ borrowed / − lent)', r.loansHere],
              ['Consumed in H360', r.outH360 ?? 'not read'],
              ['Received in H360', r.inH360 ?? 'not read'],
              ['Unexplained', r.unexplained ?? '—'],
            ].map(([k, v]) => (
              <tr key={String(k)} className="border-b border-slate-200 last:border-0">
                <td className="py-1 text-slate-600">{k}</td>
                <td className="py-1 text-right font-semibold">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.usage.length > 0 && (
          <>
            <div className="mb-1 mt-3 text-[12px] font-bold uppercase tracking-[.04em] text-slate-500">Used here</div>
            <ul className="max-h-[160px] overflow-y-auto text-[12.5px]">
              {r.usage.map((u, i) => (
                <li key={i} className="flex gap-2 py-0.5">
                  <span className="w-8 text-right font-bold">{u.qty}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {u.what === 'Visit' && u.requestId ? (
                      <Link href={`/requests/${u.requestId}`} className="text-primary-700 hover:underline">
                        {u.patient ?? u.requestNo}
                      </Link>
                    ) : (
                      `By hand ${u.ref ?? ''}`
                    )}{' '}
                    <span className="text-slate-400">{when(u.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <div className="mb-1 text-[12px] font-bold uppercase tracking-[.04em] text-slate-500">In H360 since then</div>
        {r.h360Moves.length ? (
          <ul className="max-h-[220px] overflow-y-auto text-[12.5px]">
            {r.h360Moves.map((m, i) => (
              <li key={i} className="flex gap-2 py-0.5">
                <span className={cx('w-10 text-right font-bold', m.qty < 0 ? 'text-[#B91C1C]' : 'text-[#15803D]')}>{sign(m.qty)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.type}</span>
                  <span className="text-slate-400">
                    {when(m.at)} · ref {m.ref}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[12.5px] text-slate-400">{r.outH360 == null ? 'Not read (only differences are read)' : 'No H360 transactions since then'}</div>
        )}
        {r.issue?.note && <div className="mt-3 rounded-lg bg-white px-2.5 py-2 text-[12px] text-slate-600 ring-1 ring-slate-200">Last note: {r.issue.note}</div>}
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-bold uppercase tracking-[.04em] text-slate-500">Fix</div>
        {r.itemId && r.h360 != null && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} className={btnClass('o', 'sm', 'bg-white')} onClick={() => confirm(`Set ${r.name} in HomeCare to ${r.h360} (H360)?`) && act({ action: 'match', itemIds: [r.itemId] }, 'Matched to H360')}>
              <Scale size={14} /> Match to H360 ({r.h360})
            </button>
            {r.toConsume > 0 && (
              <button type="button" disabled={busy} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act({ action: 'consumed', itemIds: [r.itemId] }, 'Consumed in H360 — matched')}>
                <ClipboardList size={14} /> Entered in H360 ✓
              </button>
            )}
            {(r.h360 ?? 0) > (r.local ?? 0) && (
              <button type="button" disabled={busy} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act({ action: 'received', itemIds: [r.itemId] }, 'Received per H360')}>
                <PackagePlus size={14} /> Received in H360 (+{(r.h360 ?? 0) - (r.local ?? 0)})
              </button>
            )}
          </div>
        )}
        {r.kind === 'ONLY_H360' && r.code && (
          <button type="button" disabled={busy} className={btnClass('p', 'sm', 'w-fit')} onClick={() => act({ action: 'add', codes: [r.code] }, `${r.name} added to the store`)}>
            <PackagePlus size={14} /> Add to HomeCare store ({r.h360} {r.unit})
          </button>
        )}
        {r.kind === 'ONLY_LOCAL' && r.itemId && (
          <div className="flex gap-1.5">
            <input className="hc-input h-8 text-[12.5px]" placeholder="H360 item code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="button" disabled={busy || !code.trim()} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act({ action: 'link', itemId: r.itemId, code: code.trim() }, 'Linked to H360')}>
              Link
            </button>
          </div>
        )}
        {r.issue && r.issue.status !== 'ACCEPTED' && (
          <>
            <div className="mt-1 flex gap-1.5">
              <select className="hc-input h-8 text-[12.5px]" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Give to">
                <option value="">Give to…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input className="hc-input h-8 text-[12.5px]" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" disabled={busy || (!who && !note.trim())} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act({ action: 'assign', ...target, userId: who || undefined, note: note.trim() || undefined }, 'Follow-up saved')}>
                <UserPlus size={14} />
              </button>
            </div>
            <div className="flex gap-1.5">
              <input className="hc-input h-8 text-[12.5px]" placeholder="Accept — reason (e.g. H360 entry tomorrow)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <select className="hc-input h-8 w-[84px] text-[12.5px]" value={days} onChange={(e) => setDays(e.target.value)} aria-label="For days">
                {['1', '3', '7', '14', '30'].map((d) => (
                  <option key={d} value={d}>
                    {d} d
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy || reason.trim().length < 3} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act({ action: 'accept', ...target, reason: reason.trim(), days: Number(days) }, 'Accepted for now')}>
                <ShieldCheck size={14} />
              </button>
            </div>
          </>
        )}
        {r.issue?.status === 'ACCEPTED' && (
          <div className="text-[12.5px] text-slate-600">
            Accepted until {when(r.issue.acceptedUntil)} — {r.issue.acceptedReason}{' '}
            <button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => act({ action: 'reopen', ...target }, 'Opened again')}>
              Open again
            </button>
          </div>
        )}
        {r.itemId && (
          <div className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
            Tolerance ±
            <input className="hc-input h-8 w-16 text-center text-[12.5px]" inputMode="numeric" value={tol} onChange={(e) => setTol(e.target.value.replace(/\D/g, ''))} />
            <button type="button" disabled={busy || tol === String(r.tolerance)} className="font-semibold text-primary-700 hover:underline disabled:opacity-40" onClick={() => act({ action: 'tolerance', itemId: r.itemId, value: Number(tol) || 0 }, 'Tolerance saved')}>
              Save
            </button>
            <span className="text-slate-400">gaps this small count as matched</span>
          </div>
        )}
      </div>
    </div>
  )
}
