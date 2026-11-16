'use client'
// Invoice tab → Live bill: the visit priced the way H360 bills this patient (by UHID: the corporate's discount per item,
// home care charges at full price) and a line-by-line check of the H360 bill already on the visit. Read-only.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Calculator, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/components/client'
import { cx, taka } from '@/lib/format'

type Line = { kind: 'service' | 'test'; code?: string; name: string; rate: number; discountPct: number; discount: number; net: number; source: 'H360' | 'SAVED' | 'HOMECARE' | 'NONE' }
type Check = { invoiceNo: string; name: string; rate: number; discount: number; expectedPct: number | null; expected: number | null; status: 'OK' | 'LOW' | 'HIGH' | 'UNKNOWN' }
type Bill = {
  uhid: string | null
  registered: boolean
  corporate?: string
  patientType?: string
  lines: Line[]
  gross: number
  discount: number
  net: number
  billed: { count: number; total: number; discount: number; payable: number } | null
  diff: number | null
  checks: Check[]
  offline?: string
}

const SOURCE: Record<Line['source'], string | null> = {
  H360: null,
  SAVED: 'saved price · H360 did not answer for it',
  HOMECARE: 'HomeCare fee · link its H360 item in Settings → Services',
  NONE: 'no price',
}

export function LiveBill({ requestId, stamp }: { requestId: string; stamp: string }) {
  const [b, setB] = useState<Bill | null>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    setBusy(true)
    try {
      setB(await api<Bill>(`/requests/${requestId}/live-bill`))
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [requestId])
  useEffect(() => {
    load()
  }, [load, stamp])

  const wrong = b?.checks.filter((c) => c.status === 'LOW' || c.status === 'HIGH') ?? []
  const checked = b?.checks.filter((c) => c.status !== 'UNKNOWN') ?? []

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Calculator size={18} className="text-primary-700" /> Live bill
        </h2>
        <span className="text-[12.5px] text-slate-500">priced by H360 for this patient</span>
        {b &&
          (b.registered ? (
            <span className="rounded-full bg-[#EDE9FE] px-2.5 py-0.5 text-[12px] font-semibold text-[#6D28D9]">
              {[b.corporate, b.patientType && b.patientType !== b.corporate ? b.patientType : null].filter(Boolean).join(' · ') || 'Registered'} · UHID {b.uhid}
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-semibold text-slate-600">{b.uhid ? `UHID ${b.uhid} not found in H360` : 'No UHID'} · full price</span>
          ))}
        <button type="button" onClick={load} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary-700 hover:underline disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      {err && <div className="mt-3 rounded-lg bg-[#FEE2E2] px-3 py-2 text-[13px] text-[#B91C1C]">{err}</div>}
      {b?.offline && <div className="mt-3 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">H360: {b.offline} — some prices may be the saved ones.</div>}

      {b && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11.5px] font-semibold uppercase tracking-[.05em] text-slate-500">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Rate</th>
                  <th className="py-2 pr-3 text-right">Discount</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {b.lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-slate-500">
                      No services or tests on this request yet.
                    </td>
                  </tr>
                )}
                {b.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 align-top">
                    <td className="py-2 pr-3">
                      <span className="font-semibold">{l.name}</span>
                      {l.code && <span className="ml-1.5 font-mono text-[11.5px] text-slate-400">{l.code}</span>}
                      <span className="ml-1.5 text-[11.5px] text-slate-400">{l.kind === 'service' ? '· home care' : ''}</span>
                      {SOURCE[l.source] && <div className={cx('text-[11.5px]', l.source === 'NONE' ? 'text-[#B45309]' : 'text-slate-500')}>{SOURCE[l.source]}</div>}
                    </td>
                    <td className="py-2 pr-3 text-right">{taka(l.rate)}</td>
                    <td className="py-2 pr-3 text-right">{l.discount > 0 ? <span className="text-[#15803D]">− {taka(l.discount)} ({l.discountPct}%)</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 text-right font-semibold">{taka(l.net)}</td>
                  </tr>
                ))}
              </tbody>
              {b.lines.length > 0 && (
                <tfoot>
                  <tr className="text-[14px]">
                    <td className="pt-2.5 pr-3 font-bold">Live total</td>
                    <td className="pt-2.5 pr-3 text-right">{taka(b.gross)}</td>
                    <td className="pt-2.5 pr-3 text-right text-[#15803D]">{b.discount > 0 ? `− ${taka(b.discount)}` : '—'}</td>
                    <td className="pt-2.5 text-right text-[16px] font-bold">{taka(b.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* the H360 bill on this visit vs the live total */}
          {b.billed ? (
            b.diff === 0 ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#DCFCE7] px-3 py-2.5 text-[13px] font-semibold text-[#15803D]">
                <CheckCircle2 size={16} /> Matches the H360 bill · {taka(b.billed.payable)}
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]">
                <AlertTriangle size={16} className="mt-0.5 flex-none" />
                <span>
                  H360 bill <b>{taka(b.billed.payable)}</b> · live total <b>{taka(b.net)}</b> · {b.diff! > 0 ? 'bill is' : 'bill is'} <b>{taka(Math.abs(b.diff!))} {b.diff! > 0 ? 'more' : 'less'}</b>. The bill has items the request doesn&rsquo;t (or the other way round) — see the suggestion below, or the line check.
                </span>
              </div>
            )
          ) : (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">No H360 bill on this visit yet — the patient should pay about {taka(b.net)}.</div>
          )}

          {/* each line of the H360 bill: the discount H360 gives this patient on it */}
          {b.checks.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-bold">Bill check</span>
                <span className={wrong.length ? 'font-semibold text-[#B91C1C]' : 'text-[#15803D]'}>
                  {wrong.length ? `${wrong.length} line${wrong.length === 1 ? '' : 's'} with the wrong discount` : `${checked.length} of ${b.checks.length} lines have the right discount`}
                </span>
              </div>
              <div className="flex flex-col divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {b.checks.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1">
                      {c.name} <span className="text-[11.5px] text-slate-400">· {c.invoiceNo}</span>
                    </span>
                    <span className="text-slate-500">
                      {taka(c.rate)} · billed discount {c.discount > 0 ? taka(c.discount) : '৳ 0'}
                    </span>
                    {c.status === 'OK' && <span className="font-semibold text-[#15803D]">✓ {c.expectedPct ? `${c.expectedPct}% as due` : 'no discount due'}</span>}
                    {c.status === 'LOW' && <span className="font-semibold text-[#B91C1C]">Due {taka(c.expected)} ({c.expectedPct}%) — missing {taka((c.expected ?? 0) - c.discount)}</span>}
                    {c.status === 'HIGH' && <span className="font-semibold text-[#B45309]">More than due: {taka(c.expected)} ({c.expectedPct}%)</span>}
                    {c.status === 'UNKNOWN' && <span className="text-slate-400">not found in H360 by name</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {!b && busy && <div className="mt-3 flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Pricing with H360…</div>}
    </section>
  )
}
