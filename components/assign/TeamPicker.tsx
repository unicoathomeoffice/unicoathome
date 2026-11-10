'use client'
// The care-team picker of W06: team size, the chosen team (primary + members) and the ranked candidates (score bar +
// badges + availability strip). Used by the Assign drawer and by New request → Assign staff (request not saved yet).
import { useEffect, useMemo, useState } from 'react'
import { Check, Star, UserX, X } from 'lucide-react'
import { useToast } from '@/components/client'
import { Avatar } from '@/components/ui'
import { ROLE_LABEL, type Role } from '@/lib/constants'
import { HisStaffSearch, type AddedStaff } from './HisStaffSearch'
import { cx } from '@/lib/format'

export type Candidate = {
  id: string
  name: string
  initials: string
  photoUrl?: string
  role: string
  designation?: string
  employeeId: string
  score: number
  skillMatch: boolean
  zoneMatch: boolean
  free: boolean
  visitsToday: number
  availability: string
  badges: string[]
  /** outside staff from the HIS (no app): coordinators do their visit steps */
  external?: boolean
}

const ROLE_CHIPS = [
  { key: '', label: 'All' },
  { key: 'DOCTOR', label: 'Doctors' },
  { key: 'NURSE', label: 'Nurses' },
  { key: 'ALLIED', label: 'Allied' },
]

function scoreTone(s: number) {
  if (s >= 80) return { text: '#15803D', bar: '#16A34A' }
  if (s >= 50) return { text: '#B45309', bar: '#F59E0B' }
  return { text: '#B91C1C', bar: '#DC2626' }
}

function Badge({ text, area }: { text: string; area: string }) {
  const green = 'bg-[#DCFCE7] text-[#15803D]'
  const red = 'bg-[#FEE2E2] text-[#B91C1C]'
  const amber = 'bg-[#FEF3C7] text-[#B45309]'
  const slate = 'bg-slate-100 text-slate-700'
  let tone = slate
  let label = text
  let tick = false
  if (text === 'Skill ✓') [tone, label, tick] = [green, 'Skill match', true]
  else if (text === 'Skill gap') tone = red
  else if (text.startsWith('Free')) [tone, tick] = [green, true]
  else if (text === 'Busy') tone = amber
  else if (text === 'On leave') tone = red
  else if (text === 'Zone ✓') [tone, label, tick] = [green, area ? `Zone · ${area}` : 'Zone match', true]
  else if (text === 'Out of zone') tone = red
  else if (text === 'Outside · HIS') tone = 'bg-[#EDE9FE] text-[#6D28D9]'
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold', tone)}>
      {tick && <Check size={12} strokeWidth={3} />}
      {label}
    </span>
  )
}

function Strip({ busy, dayStartMs, onDuty }: { busy: [number, number][]; dayStartMs: number; onDuty: boolean }) {
  const H = 3600_000
  return (
    <>
      <div className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded">
        {Array.from({ length: 12 }, (_, i) => {
          const s = dayStartMs + (9 + i) * H
          const e = s + H
          const b = !onDuty || busy.some(([bs, be]) => bs < e && be > s)
          return <div key={i} className="flex-1" style={{ background: b ? '#CBD5E1' : '#DCFCE7' }} title={`${String(9 + i).padStart(2, '0')}:00 ${b ? 'busy' : 'free'}`} />
        })}
      </div>
      <div className="mt-[3px] flex justify-between text-[10px] text-slate-400">
        <span>09</span>
        <span>13</span>
        <span>17</span>
        <span>21</span>
      </div>
    </>
  )
}

/**
 * `team` in order: [0] is the primary (must accept), the rest are members. `load` fetches the ranked candidates and
 * runs again whenever `loadKey` changes. `autoPick`: start an empty team with the best free person.
 */
export function TeamPicker({
  team,
  setTeam,
  teamSize,
  setTeamSize,
  load,
  loadKey,
  area,
  currentPrimaryId,
  busy,
  dayStartMs,
  autoPick = true,
  onLoaded,
}: {
  team: string[]
  setTeam: (t: string[] | ((cur: string[]) => string[])) => void
  teamSize: number
  setTeamSize: (n: number | ((cur: number) => number)) => void
  load: () => Promise<{ items: Candidate[] }>
  loadKey: string
  area: string
  currentPrimaryId?: string | null
  /** staff id → busy intervals [startMs, endMs] on the visit day (no strip without it) */
  busy?: Record<string, [number, number][]>
  dayStartMs?: number
  autoPick?: boolean
  /** the candidates as they load (for names outside the picker) */
  onLoaded?: (items: Candidate[]) => void
}) {
  const toast = useToast()
  const [role, setRole] = useState('')
  const [items, setItems] = useState<Candidate[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [all, setAll] = useState<Record<string, Candidate>>({})
  const primary = team[0] ?? null
  const secondary = team.slice(1)

  useEffect(() => {
    let live = true
    setItems(null)
    setErr(null)
    load()
      .then((r) => {
        if (!live) return
        setItems(r.items)
        setAll((x) => ({ ...x, ...Object.fromEntries(r.items.map((c) => [c.id, c])) }))
        onLoaded?.(r.items)
        // a new assignment starts with the best free person as primary; a reassignment keeps the current team
        if (autoPick) setTeam((cur) => (cur.length ? cur : [r.items.find((c) => c.availability === 'ON_DUTY')?.id ?? r.items[0]?.id].filter((x): x is string => !!x)))
      })
      .catch((e) => live && setErr(e.message))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey])

  const secondaryOptions = useMemo(() => Object.values(all).filter((c) => !team.includes(c.id)), [all, team])
  const shown = useMemo(() => (items ?? []).filter((c) => !role || c.role === role), [items, role])
  const nameOf = (id: string) => all[id]?.name ?? 'Current team member'

  /** Tick a card: add to the team (first pick = primary), or take them off. A full team grows up to 5. */
  function toggle(id: string) {
    const c = all[id]
    if (team.includes(id)) return setTeam(team.filter((x) => x !== id))
    if (c?.availability === 'ON_LEAVE') toast(`${c.name} is on leave — assigning anyway`, 'err')
    if (teamSize === 1) return setTeam([id]) // a one-person visit: picking someone else swaps them in
    if (team.length >= teamSize) {
      if (team.length >= 5) return toast('A care team has at most 5 people', 'err')
      setTeamSize(team.length + 1)
    }
    setTeam([...team, id])
  }
  const makePrimary = (id: string) => setTeam([id, ...team.filter((x) => x !== id)])
  /** someone picked from the HIS: known to the picker from now on, and on the team (grows the team when full) */
  function addOutside(s: AddedStaff) {
    const c: Candidate = {
      id: s.id,
      name: s.name,
      initials: s.name.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase(),
      role: s.role,
      designation: s.designation,
      employeeId: s.employeeId,
      score: 0,
      skillMatch: false,
      zoneMatch: false,
      free: true,
      visitsToday: 0,
      availability: 'ON_DUTY',
      badges: s.external ? ['Outside · HIS', ...(s.department ? [s.department] : [])] : [],
      external: s.external,
    }
    setAll((x) => ({ ...x, [c.id]: c }))
    onLoaded?.([c])
    if (team.includes(c.id)) return
    if (team.length >= 5) return toast('A care team has at most 5 people', 'err')
    if (teamSize === 1 && team.length === 1) return setTeam([c.id]) // one-person visit: the new person takes the place
    setTeam([...team, c.id])
    setTeamSize((t) => Math.max(t, team.length + 1))
  }
  function changeSize(n: number) {
    if (team.length > n) {
      const drop = team.slice(n).map(nameOf)
      if (!confirm(`Care team of ${n}: remove ${drop.join(', ')} from the team?`)) return
      setTeam(team.slice(0, n))
    }
    setTeamSize(n)
  }

  return (
    <>
      <div>
        <span className="hc-label">Care team number</span>
        <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => changeSize(n)}
              className={cx('flex h-8 flex-1 items-center justify-center rounded-lg text-sm font-semibold', n === teamSize ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-card border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between text-[13px] font-bold">
          <span>
            Care team · {team.length} of {teamSize}
          </span>
          <span className="text-[11.5px] font-normal text-slate-500">{teamSize > 1 ? 'Tick people below to fill the team' : 'Pick one person below'}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: Math.max(teamSize, team.length) }, (_, i) => {
            const id = team[i]
            const c = id ? all[id] : null
            return (
              <div key={i} className={cx('flex h-11 items-center gap-2.5 rounded-lg px-2.5', id ? 'bg-white ring-1 ring-slate-200' : 'border border-dashed border-slate-300 text-slate-400')}>
                <span className={cx('w-[74px] flex-none text-[11px] font-bold uppercase tracking-[.04em]', i === 0 ? 'text-primary-700' : 'text-[#6D28D9]')}>{i === 0 ? 'Primary' : `Member ${i + 1}`}</span>
                {id ? (
                  <>
                    <Avatar initials={c?.initials ?? '?'} photo={c?.photoUrl} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-800">
                      {nameOf(id)}
                      {c && <span className="font-normal text-slate-500"> · {ROLE_LABEL[c.role as Role] ?? c.role}</span>}
                    </span>
                    {i > 0 && (
                      <button type="button" onClick={() => makePrimary(id)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-primary-700 hover:bg-primary-50" title="Make primary">
                        <Star size={13} /> Primary
                      </button>
                    )}
                    <button type="button" onClick={() => setTeam(team.filter((x) => x !== id))} className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-[#B91C1C]" aria-label={`Remove ${nameOf(id)}`}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <span className="text-[12.5px]">{i === 0 ? 'Pick the primary from the list' : 'Empty — tick someone below'}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[13px] font-bold">Candidates · ranked</div>
        <div className="text-[11px] text-slate-500">Skill 40 · Availability 30 · Zone 20 · Workload 10</div>
      </div>
      <div className="-mt-1 flex gap-1.5">
        {ROLE_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setRole(c.key)}
            className={cx('inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-semibold', role === c.key ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}
          >
            {c.label}
          </button>
        ))}
      </div>

      {err && <div className="rounded-lg bg-[#FEE2E2] px-3 py-2 text-[13px] text-[#B91C1C]">{err}</div>}
      {!items && !err && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[138px] animate-pulse rounded-card bg-slate-100" />
          ))}
        </div>
      )}
      {items && shown.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-dashed border-slate-300 px-6 py-10 text-center">
          <UserX size={28} className="text-slate-400" />
          <div className="text-[15px] font-bold">No candidates</div>
          <div className="text-[13px] text-slate-500">No active staff match this filter. Try another role or reschedule.</div>
        </div>
      )}
      {shown.map((c) => {
        const sel = c.id === primary
        const tone = scoreTone(c.score)
        const isSecondary = secondary.includes(c.id)
        const on = sel || isSecondary
        return (
          <div
            key={c.id}
            role="checkbox"
            aria-checked={on}
            tabIndex={0}
            onClick={() => toggle(c.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(c.id))}
            className={cx('cursor-pointer rounded-card border-[1.5px] p-3.5 transition', sel ? 'border-primary bg-[#F8FCFE]' : isSecondary ? 'border-[#A78BFA] bg-[#FAF8FF]' : 'border-slate-200 bg-white hover:border-slate-300')}
          >
            <div className="flex items-center gap-3">
              <span className={cx('flex size-[22px] flex-none items-center justify-center rounded-md border-2', sel ? 'border-primary bg-primary text-white' : isSecondary ? 'border-[#7C3AED] bg-[#7C3AED] text-white' : 'border-slate-300 bg-white')}>{on && <Check size={14} strokeWidth={3} />}</span>
              <Avatar initials={c.initials} photo={c.photoUrl} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14px] font-bold">
                  <span className="truncate">{c.name}</span>
                  {c.id === currentPrimaryId && <span className="rounded-full bg-slate-100 px-1.5 text-[10.5px] font-bold text-slate-600">CURRENT</span>}
                  {sel && <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">PRIMARY</span>}
                  {isSecondary && <span className="rounded-full bg-[#EDE9FE] px-1.5 text-[10.5px] font-bold text-[#6D28D9]">MEMBER {team.indexOf(c.id) + 1}</span>}
                </div>
                <div className="truncate text-[12px] text-slate-500">{[c.designation, ROLE_LABEL[c.role as Role] ?? c.role, c.employeeId].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-right text-[18px] font-bold" style={{ color: tone.text }}>
                  {c.score}
                </div>
                {isSecondary && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      makePrimary(c.id)
                    }}
                    className="text-[11.5px] font-semibold text-primary-700 hover:underline"
                  >
                    Make primary
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-slate-100">
              <div className="h-full" style={{ width: `${Math.min(100, c.score)}%`, background: tone.bar }} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {c.badges.map((b) => (
                <Badge key={b} text={b} area={area} />
              ))}
            </div>
            {busy && dayStartMs != null && <Strip busy={busy[c.id] ?? []} dayStartMs={dayStartMs} onDuty={c.availability === 'ON_DUTY'} />}
          </div>
        )
      })}

      <div>
        <span className="hc-label">Add to team (any staff)</span>
        <select
          className="hc-input"
          value=""
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            if (team.length >= 5) return toast('A care team has at most 5 people', 'err')
            setTeam(team.length ? [...team, id] : [id])
            setTeamSize((t) => Math.max(t, team.length + 1))
          }}
        >
          <option value="">{team.length ? 'Add another person…' : 'Pick someone…'}</option>
          {secondaryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {ROLE_LABEL[c.role as Role] ?? c.role}
              {c.external ? ' · outside' : ''}
            </option>
          ))}
        </select>
      </div>
      <HisStaffSearch taken={team} onAdd={addOutside} />
    </>
  )
}

/** First names for buttons: "Dr. Farhana Akter" → "Farhana". */
export const firstName = (n: string) => n.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(' ')[0]
