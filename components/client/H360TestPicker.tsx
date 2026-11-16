'use client'
import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Search, X } from 'lucide-react'
import { api } from './api'
import { ChipPicker } from './index'
import { TESTS_PROCEDURES } from '@/lib/constants'
import { cx, taka } from '@/lib/format'
import { testsTotal, type TestItem } from '@/lib/schemas'

type Hit = TestItem & { type?: string; discountPct?: number }

/**
 * Tests / procedures from H360's own catalog — code, name and price as H360 bills them (search by name or code, like
 * H360's billing "Service" box). Read-only: nothing is saved in H360. When H360 isn't reachable the usual quick list
 * (names only) still works.
 */
export function H360TestPicker({
  value,
  onChange,
  plain = [],
  onPlainChange,
  patientType,
  corporate,
  uhid,
  compact,
}: {
  value: TestItem[]
  onChange: (v: TestItem[]) => void
  /** names picked from the quick list (no H360 code / price) */
  plain?: string[]
  onPlainChange?: (v: string[]) => void
  patientType?: string
  corporate?: boolean
  /** registered patient: prices come with the discount H360 gives their corporate (e.g. 40% senior citizen on tests) */
  uhid?: string
  compact?: boolean
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState<string | null>(null)
  const [showQuick, setShowQuick] = useState(false)
  // discount per code for this patient (H360, by UHID) and the corporate it comes from
  const [pct, setPct] = useState<Record<string, number>>({})
  const [corpName, setCorpName] = useState<string | null>(null)
  const u = (uhid ?? '').trim()

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    let live = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: Hit[]; offline?: boolean; code?: string; error?: string; corporate?: string | null }>(`/h360/items?q=${encodeURIComponent(term)}${patientType ? `&type=${encodeURIComponent(patientType)}` : ''}${u ? `&uhid=${encodeURIComponent(u)}` : ''}`)
        if (!live) return
        setHits(r.items)
        setCorpName(r.corporate ?? null)
        setPct((m) => ({ ...m, ...Object.fromEntries(r.items.filter((h) => h.code && h.discountPct != null).map((h) => [h.code, h.discountPct!])) }))
        setOffline(r.offline ? (r.code === 'NOT_CONFIGURED' ? 'H360 is not connected (Settings → Integrations)' : 'H360 is not answering right now') : null)
      } catch {
        if (live) setOffline('H360 search failed')
      } finally {
        if (live) setBusy(false)
      }
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, patientType, u])

  const picked = (h: Hit) => value.some((v) => (h.code ? v.code === h.code : v.name === h.name))
  const add = (h: Hit) => {
    if (picked(h)) return
    onChange([...value, { code: h.code, name: h.name, price: h.price, dept: h.dept }])
  }
  const total = testsTotal(value)
  const off = (v: TestItem) => (u && v.code && pct[v.code] ? Math.round(((v.price ?? 0) * pct[v.code]) / 100) : 0)
  const totalOff = value.reduce((a, v) => a + off(v), 0)
  const PriceTag = ({ v, p }: { v: TestItem; p?: number }) =>
    p ? (
      <span className="flex flex-none items-baseline gap-1.5">
        <span className="text-[12px] text-slate-400 line-through">{taka(v.price)}</span>
        <span className="font-bold text-[#15803D]">{taka((v.price ?? 0) - Math.round(((v.price ?? 0) * p) / 100))}</span>
        <span className="rounded bg-[#DCFCE7] px-1 text-[10.5px] font-bold text-[#15803D]">−{p}%</span>
      </span>
    ) : (
      <span className="flex-none font-bold text-slate-800">{taka(v.price)}</span>
    )

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={cx('hc-input pl-9', !compact && 'hc-input-lg')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search H360 tests & procedures — name or code (e.g. creatinine, L149, CBC)" />
        {busy && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      </label>

      {q.trim().length >= 2 && (hits.length > 0 || (!busy && !offline)) && (
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {hits.map((h) => {
            const on = picked(h)
            return (
              <button key={`${h.code}-${h.name}`} type="button" onClick={() => add(h)} disabled={on} className={cx('flex min-h-11 w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-[13.5px] last:border-b-0', on ? 'bg-primary-50' : 'hover:bg-slate-50')}>
                <span className="w-[86px] flex-none font-mono text-[12px] font-semibold text-slate-500">{h.code || '—'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{h.name}</span>
                  {h.dept && <span className="block truncate text-[12px] text-slate-500">{h.dept}</span>}
                </span>
                <PriceTag v={h} p={u ? h.discountPct : undefined} />
                <span className={cx('flex size-7 flex-none items-center justify-center rounded-full', on ? 'bg-primary text-white' : 'bg-slate-100 text-primary-700')}>{on ? <Check size={14} /> : <Plus size={14} />}</span>
              </button>
            )
          })}
          {!hits.length && !busy && <div className="px-3 py-2.5 text-[13px] text-slate-500">Nothing in H360 for “{q.trim()}”.</div>}
        </div>
      )}
      {offline && <div className="rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">{offline} — use the quick list below.</div>}

      {value.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {value.map((v) => (
            <div key={`${v.code}-${v.name}`} className="flex items-center gap-2.5 rounded-lg bg-primary-50/70 px-3 py-2 text-[13.5px] ring-1 ring-primary/20">
              <span className="w-[86px] flex-none font-mono text-[12px] font-semibold text-primary-700">{v.code || '—'}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{v.name}</span>
              <PriceTag v={v} p={u && v.code ? pct[v.code] : undefined} />
              <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="flex size-8 flex-none items-center justify-center rounded-full text-slate-400 hover:bg-white hover:text-[#B91C1C]" aria-label={`Remove ${v.name}`}>
                <X size={15} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between px-1 text-[13px]">
            <span className="text-slate-500">
              {value.length} from H360
              {corpName && totalOff > 0 ? ` · ${corpName} discount as in H360` : corporate && !u ? ' · corporate price may differ in H360' : ''}
            </span>
            <span className="font-bold">
              Tests total {totalOff > 0 ? <><span className="font-normal text-slate-400 line-through">{taka(total)}</span> {taka(total - totalOff)}</> : taka(total)}
            </span>
          </div>
        </div>
      )}

      {onPlainChange && (
        <div>
          <button type="button" onClick={() => setShowQuick((x) => !x)} className="text-[12.5px] font-semibold text-primary-700 hover:underline">
            {showQuick ? 'Hide quick list' : `Quick list (names only)${plain.length ? ` · ${plain.length} picked` : ''}`}
          </button>
          {(showQuick || offline) && (
            <div className="mt-2">
              <ChipPicker options={[...new Set([...TESTS_PROCEDURES, ...plain])]} value={plain} onChange={onPlainChange} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
