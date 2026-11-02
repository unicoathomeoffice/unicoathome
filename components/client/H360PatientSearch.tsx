'use client'
// Live H360 (hospital HIS) patient search results — shown under the HomeCare search box on New request and Patients.
// Typing a UHID, mobile or name searches H360's Patient List directly; "Use" hands the record to the caller.
import { useEffect, useState } from 'react'
import { Building2, Check, Loader2 } from 'lucide-react'
import { api } from './api'
import { cx } from '@/lib/format'

export type H360Hit = { uhid: string; name: string; dob?: string; ageYears?: number; gender?: string; ageGender?: string; company?: string; phone?: string; address?: string; guardianName?: string; regType?: string; linkedPatientId: string | null }

export function H360PatientSearch({ q, onUse, useLabel = 'Use', className }: { q: string; onUse: (p: H360Hit) => void; useLabel?: string; className?: string }) {
  const [state, setState] = useState<{ loading: boolean; items: H360Hit[]; error?: string; offline?: boolean; code?: string }>({ loading: false, items: [] })
  const term = q.trim()

  useEffect(() => {
    if (term.length < 3) {
      setState({ loading: false, items: [] })
      return
    }
    let live = true
    setState((s) => ({ ...s, loading: true }))
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: H360Hit[]; offline?: boolean; error?: string; code?: string }>(`/h360/patients?q=${encodeURIComponent(term)}`)
        if (live) setState({ loading: false, items: r.items, offline: r.offline, error: r.error, code: r.code })
      } catch (e: any) {
        if (live) setState({ loading: false, items: [], offline: true, error: e.message })
      }
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [term])

  if (term.length < 3) return null
  if (state.code === 'NOT_CONFIGURED') return null // H360 not connected yet: stay quiet
  return (
    <div className={cx('overflow-hidden rounded-[10px] border border-slate-200', className)}>
      <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">
        <Building2 size={14} /> From H360 hospital records
        {state.loading && <Loader2 size={13} className="ml-auto animate-spin" />}
      </div>
      {state.offline ? (
        <div className="px-3.5 py-3 text-[13px] text-[#B45309]">H360 is not answering — showing HomeCare results only{state.error ? ` (${state.error})` : ''}.</div>
      ) : !state.loading && !state.items.length ? (
        <div className="px-3.5 py-3 text-[13px] text-slate-500">No match in H360 for “{term}”.</div>
      ) : (
        state.items.map((p, i) => (
          <div key={`${p.uhid}-${i}`} className="flex items-center gap-3 border-t border-slate-100 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {p.name}{' '}
                <span className="font-normal text-slate-500">
                  {[p.ageGender || (p.ageYears != null ? `${p.ageYears}${p.gender ? ` ${p.gender}` : ''}` : ''), p.uhid && `UHID ${p.uhid}`].filter(Boolean).map((x) => ` · ${x}`)}
                </span>
              </div>
              <div className="truncate text-[12px] text-slate-500">{[p.phone, p.address, p.guardianName && `Guardian ${p.guardianName}`, p.regType].filter(Boolean).join(' · ')}</div>
            </div>
            {p.linkedPatientId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-bold text-[#15803D]">
                <Check size={12} /> In HomeCare
              </span>
            )}
            <button type="button" onClick={() => onUse(p)} className="inline-flex h-[30px] flex-none items-center rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {useLabel}
            </button>
          </div>
        ))
      )}
    </div>
  )
}
