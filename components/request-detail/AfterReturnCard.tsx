'use client'
// "After return to hospital": the items the team does once back (e.g. samples handed to the lab). Ticked by the team
// on the app or by a coordinator on the web; required ones must be done before the visit is closed.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, Loader2, RotateCcw } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { cx } from '@/lib/format'

export type AfterRow = { key: string; label: string; mandatory: boolean; withNote?: boolean; notePrompt?: string; done: boolean; doneAt?: string | null; doneByName?: string | null; note?: string | null }

const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }) : '')

export function AfterReturnCard({ requestId, items, canTick, canReopen, big = false, hint }: { requestId: string; items: AfterRow[]; canTick: boolean; canReopen: boolean; big?: boolean; hint?: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  if (!items.length) return null
  const open = items.filter((i) => !i.done)
  const reqOpen = open.filter((i) => i.mandatory).length

  async function tick(i: AfterRow, done: boolean) {
    let reason: string | undefined
    if (!done) {
      reason = window.prompt(`Re-open "${i.label}" — why?`)?.trim()
      if (!reason) return
    }
    setBusy(i.key)
    try {
      await api(`/requests/${requestId}/after-checklist/${i.key}`, { method: 'PATCH', body: { done, note: notes[i.key]?.trim() || undefined, reason } })
      toast(done ? `${i.label} ✓` : `${i.label} re-opened`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cx('rounded-card bg-white shadow-card', big ? 'p-4' : 'p-4')}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Building2 size={17} className="text-navy" /> After return to hospital
        </h2>
        <span className={cx('text-[12.5px] font-semibold', reqOpen ? 'text-[#B45309]' : 'text-[#15803D]')}>{reqOpen ? `${reqOpen} required item${reqOpen === 1 ? '' : 's'} open` : open.length ? 'Required items done' : 'All done'}</span>
      </div>
      {hint && <div className="mb-2 text-[12.5px] text-slate-500">{hint}</div>}
      <ul className="flex flex-col divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.key} className={cx('flex flex-wrap items-center gap-3', big ? 'py-3' : 'py-2.5')}>
            <button
              type="button"
              disabled={!canTick || !!busy || (i.done && !canReopen)}
              onClick={() => tick(i, !i.done)}
              aria-label={i.done ? `Re-open ${i.label}` : `Tick ${i.label}`}
              className={cx('flex flex-none items-center justify-center rounded-lg border-2', big ? 'size-11' : 'size-8', i.done ? 'border-[#16A34A] bg-[#16A34A] text-white' : 'border-slate-300 bg-white text-transparent hover:border-primary', (!canTick || (i.done && !canReopen)) && 'cursor-default')}
            >
              {busy === i.key ? <Loader2 size={16} className="animate-spin text-slate-500" /> : <Check size={big ? 20 : 16} strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className={cx('font-semibold', big ? 'text-[15px]' : 'text-[14px]', i.done ? 'text-slate-500' : 'text-slate-800')}>
                {i.label} {i.mandatory ? <span className="text-[11px] font-bold text-[#DC2626]">REQUIRED</span> : <span className="text-[11px] font-semibold text-slate-400">optional</span>}
              </div>
              {i.done ? (
                <div className="text-[12px] text-slate-500">
                  Done {hm(i.doneAt)}
                  {i.doneByName ? ` · ${i.doneByName}` : ''}
                  {i.note ? ` · ${i.note}` : ''}
                </div>
              ) : (
                i.withNote &&
                canTick && <input className={cx('hc-input mt-1.5', big ? 'hc-input-lg' : 'h-9')} placeholder={i.notePrompt || 'Note'} value={notes[i.key] ?? ''} onChange={(e) => setNotes({ ...notes, [i.key]: e.target.value })} />
              )}
            </div>
            {i.done && canReopen && !big && (
              <button type="button" onClick={() => tick(i, false)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-slate-700">
                <RotateCcw size={13} /> Re-open
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
