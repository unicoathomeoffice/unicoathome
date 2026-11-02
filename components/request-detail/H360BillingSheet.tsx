'use client'
import { useState } from 'react'
import { Check, ClipboardCopy, Receipt } from 'lucide-react'
import { btnClass } from '@/components/ui'
import { taka } from '@/lib/format'
import { testsTotal, type TestItem } from '@/lib/schemas'

/**
 * Invoice tab → "For H360 billing": everything the cash counter needs to bill this visit in H360 (UHID, category, the
 * tests / procedures with H360 code and price). View only — this app never saves anything in H360.
 */
export function H360BillingSheet({ uhid, category, items, plain, services }: { uhid?: string; category?: string; items: TestItem[]; plain: string[]; services: string[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  const codes = items.map((i) => i.code).filter(Boolean)
  async function copy(what: 'codes' | 'uhid', text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      /* clipboard blocked */
    }
  }
  if (!items.length && !plain.length) return null
  return (
    <section className="mb-5 rounded-card bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start gap-3">
        <Receipt size={20} className="mt-0.5 text-primary-700" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold">For H360 billing</h3>
          <p className="text-[12.5px] text-slate-500">Enter these in H360’s billing screen and save there — this app only reads H360 (view and prices), it never saves in H360.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {uhid && (
            <button type="button" className={btnClass('o', 'sm')} onClick={() => copy('uhid', uhid)}>
              {copied === 'uhid' ? <Check size={14} /> : <ClipboardCopy size={14} />} UHID {uhid}
            </button>
          )}
          {codes.length > 0 && (
            <button type="button" className={btnClass('s', 'sm')} onClick={() => copy('codes', codes.join(', '))}>
              {copied === 'codes' ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied === 'codes' ? 'Copied' : `Copy ${codes.length} code${codes.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 text-[12.5px] text-slate-500">
        {[category && `Patient category ${category}`, services.length && `Service: ${services.join(', ')}`].filter(Boolean).join(' · ')}
      </div>
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[110px_1fr_140px_110px] bg-slate-50 px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">
          <div>H360 code</div>
          <div>Test / procedure</div>
          <div>Department</div>
          <div className="text-right">Rate</div>
        </div>
        {items.map((i) => (
          <div key={`${i.code}-${i.name}`} className="grid grid-cols-[110px_1fr_140px_110px] border-t border-slate-100 px-3.5 py-2 text-[13.5px]">
            <div className="font-mono font-semibold text-primary-700">{i.code || '—'}</div>
            <div className="min-w-0 truncate font-semibold">{i.name}</div>
            <div className="truncate text-slate-500">{i.dept || '—'}</div>
            <div className="text-right font-semibold">{taka(i.price)}</div>
          </div>
        ))}
        {plain.map((n) => (
          <div key={n} className="grid grid-cols-[110px_1fr_140px_110px] border-t border-slate-100 px-3.5 py-2 text-[13.5px] text-slate-500">
            <div>—</div>
            <div className="min-w-0 truncate">{n}</div>
            <div>search in H360</div>
            <div className="text-right">—</div>
          </div>
        ))}
        {items.length > 0 && (
          <div className="grid grid-cols-[1fr_110px] border-t border-slate-200 bg-slate-50 px-3.5 py-2 text-[13.5px] font-bold">
            <div>Total at H360 rates{/corporate/i.test(category ?? '') ? ' (corporate price may differ)' : ''}</div>
            <div className="text-right">{taka(testsTotal(items))}</div>
          </div>
        )}
      </div>
    </section>
  )
}
