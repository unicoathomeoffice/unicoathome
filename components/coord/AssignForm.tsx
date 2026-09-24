'use client'
import { useMemo, useState } from 'react'
import { Check, Loader2, ChevronDown } from 'lucide-react'
import { api, useAction, useToast } from '@/components/client'
import { cx } from '@/lib/format'
import { FLabel, SLabel, FixedBottom, bbtn, scoreColor } from './ui'

export type Cand = {
  id: string
  name: string
  initials: string
  role: string
  designation?: string
  employeeId: string
  score: number
  free: boolean
  zoneMatch: boolean
  skillMatch: boolean
  visitsToday: number
  availability: string
  badges: string[]
}

const GROUPS: { role: string; label: string }[] = [
  { role: 'DOCTOR', label: 'Doctor' },
  { role: 'NURSE', label: 'Nurse' },
  { role: 'ALLIED', label: 'Allied · phlebotomy · physio' },
]

/** S3 / M18 — team number, ranked candidates grouped by role, primary + others, instructions. */
export function AssignForm({ id, requestNo, candidates, need, initialTeam, initialSize, instructions: initialInstr, transport }: { id: string; requestNo: string; candidates: Cand[]; need: Record<string, number>; initialTeam: string[]; initialSize: number; instructions?: string; transport: boolean }) {
  const [size, setSize] = useState(Math.min(5, Math.max(1, initialSize)))
  const [picked, setPicked] = useState<string[]>(initialTeam)
  const [instructions, setInstructions] = useState(initialInstr ?? '')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const { run, busy } = useAction()
  const toast = useToast()
  const byRole = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.role, candidates.filter((c) => c.role === g.role)])), [candidates])

  function toggle(c: Cand) {
    if (picked.includes(c.id)) return setPicked(picked.filter((x) => x !== c.id))
    if (c.availability === 'ON_LEAVE') return toast(`${c.name} is on leave`, 'err')
    const next = [...picked, c.id]
    if (next.length > size) {
      if (next.length > 5) return toast('A care team has at most 5 people', 'err')
      setSize(next.length)
    }
    setPicked(next)
  }
  function changeSize(n: number) {
    setSize(n)
    if (picked.length > n) setPicked(picked.slice(0, n))
  }
  const ready = picked.length === size
  return (
    <>
      <div>
        <FLabel req>Care team number</FLabel>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => changeSize(n)} className={cx('h-11 rounded-[10px] text-[15px] font-bold', n === size ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {[...GROUPS].sort((a, b) => (need[b.role] ?? 0) - (need[a.role] ?? 0)).map((g, gi) => {
        const list = byRole[g.role] ?? []
        if (!list.length) return null
        const count = picked.filter((pid) => list.some((c) => c.id === pid)).length
        const want = need[g.role]
        const shown = open[g.role] ? list : list.slice(0, Math.max(3, list.filter((c) => picked.includes(c.id)).length))
        return (
          <div key={g.role} className="grid gap-2">
            <SLabel right={gi === 0 ? 'ranked' : undefined}>
              {g.label} · {want ? `${count} of ${want}` : `${count} picked`}
            </SLabel>
            {shown.map((c) => {
              const on = picked.includes(c.id)
              const primary = picked[0] === c.id
              const off = c.availability !== 'ON_DUTY'
              return (
                <div key={c.id} role="button" tabIndex={0} onClick={() => toggle(c)} className={cx('flex cursor-pointer items-center gap-3 rounded-card bg-white px-3.5 py-3 shadow-card', on ? 'ring-[1.5px] ring-primary' : '', off && !on && 'opacity-60')}>
                  <span className={cx('flex size-[22px] flex-none items-center justify-center rounded-md border-2', on ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white')}>{on && <Check size={14} strokeWidth={3} />}</span>
                  <div className="flex size-10 flex-none items-center justify-center rounded-full bg-primary-50 text-[14px] font-bold text-primary-700">{c.initials}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-bold">{c.name}</span>
                      {primary && <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-white">PRIMARY</span>}
                    </div>
                    <div className="text-[12px] leading-[17px] text-slate-500">
                      {[c.designation ?? g.label, c.employeeId, ...c.badges.filter((b) => b !== 'Skill ✓' && !/^0 visits/.test(b))].join(' · ')}
                    </div>
                    {on && !primary && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPicked([c.id, ...picked.filter((x) => x !== c.id)])
                        }}
                        className="mt-1 text-[12px] font-semibold text-primary-700"
                      >
                        Make primary
                      </button>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[17px] font-bold" style={{ color: scoreColor(c.score) }}>
                      {c.score}
                    </div>
                  </div>
                </div>
              )
            })}
            {list.length > shown.length && (
              <button type="button" onClick={() => setOpen({ ...open, [g.role]: true })} className="flex h-10 items-center justify-center gap-1 text-[13px] font-semibold text-primary-700">
                Show all {list.length} <ChevronDown size={16} />
              </button>
            )}
          </div>
        )
      })}
      {!candidates.length && <div className="rounded-card bg-white p-5 text-center text-[14px] text-slate-500 shadow-card">No active field staff found. Try another slot or check staff availability.</div>}

      <div>
        <FLabel>Instructions to team</FLabel>
        <textarea className="hc-input hc-input-lg h-20 py-2.5" placeholder="Optional" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <div className="text-center text-[12px] text-slate-400">Score = skill 40 · availability 30 · zone 20 · workload 10. The first pick is primary and must accept within the timeout.</div>

      <FixedBottom note={!picked.length ? undefined : !ready ? `Pick ${size - picked.length} more or lower the team number` : transport ? 'The car supervisor already has the trip request' : undefined}>
        <button
          type="button"
          disabled={busy || !ready}
          className={bbtn('p', 'flex-1')}
          onClick={() =>
            run(
              () => api(`/requests/${id}/assign`, { body: { primaryStaffId: picked[0], secondaryStaffIds: picked.slice(1), teamSize: size, instructions: instructions.trim() || undefined } }),
              `${requestNo} assigned · team notified`,
              { redirect: `/m/admin/requests/${id}` },
            )
          }
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          {picked.length ? `Assign ${picked.length} · notify team` : 'Pick the care team'}
        </button>
      </FixedBottom>
    </>
  )
}
