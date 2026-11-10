'use client'
// "Outside staff (HIS)": find a hospital employee who is not in HomeCare (the HIS roster's Employee Search, read-only)
// and put them on the care team. The server adds them as outside staff with no login, or reuses their account.
import { useEffect, useState } from 'react'
import { Building2, Loader2, Plus, Search } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { cx, phone as fmtPhone } from '@/lib/format'

type Hit = { employeeId: string; name: string; designation?: string; department?: string; gender?: string; phone?: string; userId: string | null; inApp: boolean; active: boolean | null }
export type AddedStaff = { id: string; name: string; role: string; external: boolean; employeeId: string; designation?: string; department?: string }

export function HisStaffSearch({ onAdd, taken = [], big = false }: { onAdd: (s: AddedStaff) => void; taken?: string[]; big?: boolean }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits(null)
      setNote(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      api<{ items: Hit[]; offline?: boolean; error?: string }>(`/h360/staff?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (!live) return
          setHits(r.items)
          setNote(r.offline ? `HIS not reachable: ${r.error ?? 'try again'}` : r.items.length ? null : 'No employee found in the HIS')
        })
        .catch((e) => live && (setHits([]), setNote(e.message)))
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  async function add(h: Hit) {
    setBusy(h.employeeId)
    try {
      const r = await api<{ id: string; name: string; role: string; external: boolean; created: boolean }>('/users/external', { body: { employeeId: h.employeeId } })
      onAdd({ ...r, employeeId: h.employeeId, designation: h.designation, department: h.department })
      toast(r.created ? `${r.name} added as outside staff` : `${r.name} added to the team`, 'ok')
      setQ('')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-card border border-dashed border-[#C4B5FD] bg-[#FAF8FF] p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-[#5B21B6]">
        <Building2 size={15} /> Outside staff (HIS)
        <span className="font-normal text-slate-500">· hospital employees not in HomeCare</span>
      </div>
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={cx('hc-input pl-9', big && 'hc-input-lg')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or employee ID, e.g. Khadija or 11809" />
      </label>
      {q.trim().length >= 2 && !hits && <Loader2 size={16} className="mt-2 animate-spin text-slate-400" />}
      {note && <div className="mt-2 text-[12.5px] text-slate-500">{note}</div>}
      {!!hits?.length && (
        <ul className="mt-2 flex flex-col divide-y divide-[#EDE9FE] overflow-hidden rounded-lg bg-white ring-1 ring-[#EDE9FE]">
          {hits.map((h) => {
            const onTeam = !!h.userId && taken.includes(h.userId)
            return (
              <li key={h.employeeId} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-slate-800">
                    {h.name} <span className="font-normal text-slate-500">· {h.employeeId}</span>
                    {h.inApp ? <span className="ml-1.5 rounded-full bg-primary-50 px-1.5 text-[10.5px] font-bold text-primary-700">IN HOMECARE</span> : <span className="ml-1.5 rounded-full bg-[#EDE9FE] px-1.5 text-[10.5px] font-bold text-[#6D28D9]">OUTSIDE</span>}
                  </div>
                  <div className="truncate text-[12px] text-slate-500">{[h.designation, h.department, h.phone && fmtPhone(h.phone)].filter(Boolean).join(' · ')}</div>
                </div>
                <button
                  type="button"
                  disabled={!!busy || onTeam || h.active === false}
                  onClick={() => add(h)}
                  className={cx('inline-flex flex-none items-center gap-1 rounded-lg px-3 text-[13px] font-semibold', big ? 'h-11' : 'h-8', onTeam ? 'text-slate-400' : 'bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50')}
                >
                  {busy === h.employeeId ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {onTeam ? 'On team' : h.active === false ? 'Inactive' : 'Add'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
