'use client'
// W06 Assign drawer — ranked candidates (score bar + badges + availability strip), schedule, care team, fee, instructions, WhatsApp notify.
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, UserX, X } from 'lucide-react'
import { api, useAction, Drawer, Toggle, WhatsAppButton } from '@/components/client'
import { Avatar, btnClass } from '@/components/ui'
import { ROLE_LABEL, type Role } from '@/lib/constants'
import { cx } from '@/lib/format'

export type Candidate = {
  id: string
  name: string
  initials: string
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
}

export type AssignProps = {
  open: boolean
  onClose: () => void
  requestId: string
  requestNo: string
  sub: string
  area: string
  reassign: boolean
  date: string
  time: string
  slot: string
  duration: number
  fee: number | null
  instructions: string
  teamSize: number
  currentPrimaryId: string | null
  currentSecondaryIds: string[]
  /** staff id → busy intervals [startMs, endMs] on the visit day */
  busy: Record<string, [number, number][]>
  /** 00:00 of the visit day (Dhaka) in ms */
  dayStartMs: number
  acceptTimeoutMin: number
  slots: string[]
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

export function AssignDrawer(p: AssignProps) {
  const { run, busy } = useAction()
  const [role, setRole] = useState('')
  const [items, setItems] = useState<Candidate[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [primary, setPrimary] = useState<string | null>(null)
  const [secondary, setSecondary] = useState<string[]>(p.currentSecondaryIds)
  const [teamSize, setTeamSize] = useState(Math.max(1, p.teamSize || 1))
  const [date, setDate] = useState(p.date)
  const [slot, setSlot] = useState(p.slot)
  const [duration, setDuration] = useState(String(p.duration || 45))
  const [fee, setFee] = useState(p.fee?.toString() ?? '')
  const [instructions, setInstructions] = useState(p.instructions)
  const [notify, setNotify] = useState(true)
  const [done, setDone] = useState<null | { id: string; name: string }>(null)
  const [all, setAll] = useState<Record<string, Candidate>>({})

  useEffect(() => {
    if (!p.open) return
    let live = true
    setItems(null)
    setErr(null)
    api<{ items: Candidate[] }>(`/requests/${p.requestId}/candidates${role ? `?role=${role}` : ''}`)
      .then((r) => {
        if (!live) return
        setItems(r.items)
        setAll((x) => ({ ...x, ...Object.fromEntries(r.items.map((c) => [c.id, c])) }))
        setPrimary((cur) => cur ?? r.items.find((c) => c.id !== p.currentPrimaryId && c.availability === 'ON_DUTY')?.id ?? r.items[0]?.id ?? null)
      })
      .catch((e) => live && setErr(e.message))
    return () => {
      live = false
    }
  }, [p.open, p.requestId, role, p.currentPrimaryId])

  useEffect(() => {
    if (!p.open) setDone(null)
  }, [p.open])

  const chosen = primary ? all[primary] : null
  const secondaryOptions = useMemo(() => Object.values(all).filter((c) => c.id !== primary && !secondary.includes(c.id)), [all, primary, secondary])
  const dirtySchedule = date !== p.date || slot !== p.slot

  async function submit() {
    if (!primary) return
    const sec = secondary.filter((s) => s !== primary)
    const r = await run(
      () =>
        api(`/requests/${p.requestId}/assign`, {
          body: {
            primaryStaffId: primary,
            secondaryStaffIds: sec,
            teamSize: Math.max(teamSize, 1 + sec.length),
            ...(dirtySchedule ? { date, slot: slot || undefined, time: slot !== p.slot ? undefined : p.time || undefined } : {}),
            expectedDurationMin: Number(duration) || undefined,
            instructions: instructions.trim() || undefined,
            fee: fee === '' ? undefined : Number(fee),
          },
        }),
      `${p.reassign ? 'Reassigned' : 'Assigned'} to ${chosen?.name ?? 'staff'}`,
    )
    if (r === undefined) return
    if (notify) setDone({ id: primary, name: chosen?.name ?? 'staff' })
    else p.onClose()
  }

  if (!p.open) return null

  if (done)
    return (
      <Drawer open onClose={p.onClose} title="Notify staff" sub={`${p.requestNo} · assigned to ${done.name}`} width={560}>
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]">
            <Check size={28} strokeWidth={3} />
          </div>
          <div className="text-[17px] font-bold">{done.name} has been assigned</div>
          <div className="max-w-sm text-[13px] text-slate-500">
            They got a push and in-app card and must accept within {p.acceptTimeoutMin} min. Send the staff_assigned WhatsApp from your phone as well.
          </div>
          <WhatsAppButton requestId={p.requestId} templateKey="staff_assigned" to="staff" staffId={done.id} kind="g" size="lg" className="mt-2 w-full max-w-xs">
            Notify {done.name.split(' ')[0]} via WhatsApp
          </WhatsAppButton>
          <button className={btnClass('o', 'md', 'w-full max-w-xs')} onClick={p.onClose}>
            Done
          </button>
        </div>
      </Drawer>
    )

  return (
    <Drawer
      open
      onClose={p.onClose}
      title={p.reassign ? 'Reassign staff' : 'Assign staff'}
      sub={p.sub}
      width={560}
      footer={
        <>
          <span className="mr-auto text-[12px] text-slate-500">Staff must accept within {p.acceptTimeoutMin} min</span>
          <button className={btnClass('o', 'md', 'h-10 px-[18px]')} onClick={p.onClose}>
            Cancel
          </button>
          <button className={btnClass('p', 'md', 'h-10 px-[18px]')} disabled={busy || !primary || !date} onClick={submit}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {p.reassign ? 'Reassign to' : 'Assign'} {chosen?.name ?? ''}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-3 gap-2.5">
          <label>
            <span className="hc-label">Date</span>
            <input type="date" className="hc-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span className="hc-label">Slot</span>
            <select className="hc-input" value={slot} onChange={(e) => setSlot(e.target.value)}>
              <option value="">{p.time ? `At ${p.time}` : 'No slot'}</option>
              {p.slots.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/^(\d\d)–(\d\d)$/, '$1:00 – $2:00')}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="hc-label">Duration (min)</span>
            <input type="number" min={5} step={5} className="hc-input" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
        </div>

        <div>
          <span className="hc-label">Care team number</span>
          <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setTeamSize(n)
                  setSecondary((s) => s.slice(0, n - 1))
                }}
                className={cx('flex h-8 flex-1 items-center justify-center rounded-lg text-sm font-semibold', n === teamSize ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}
              >
                {n}
              </button>
            ))}
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
        {items && items.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 rounded-card border border-dashed border-slate-300 px-6 py-10 text-center">
            <UserX size={28} className="text-slate-400" />
            <div className="text-[15px] font-bold">No candidates</div>
            <div className="text-[13px] text-slate-500">No active staff match this filter. Try another role or reschedule.</div>
          </div>
        )}
        {items?.map((c) => {
          const sel = c.id === primary
          const tone = scoreTone(c.score)
          const isSecondary = secondary.includes(c.id)
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setPrimary(c.id)
                setSecondary((s) => s.filter((x) => x !== c.id))
              }}
              onKeyDown={(e) => e.key === 'Enter' && setPrimary(c.id)}
              className={cx('cursor-pointer rounded-card border-[1.5px] p-3.5 transition', sel ? 'border-primary bg-[#F8FCFE]' : 'border-slate-200 bg-white hover:border-slate-300')}
            >
              <div className="flex items-center gap-3">
                <Avatar initials={c.initials} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-bold">
                    <span className="truncate">{c.name}</span>
                    {c.id === p.currentPrimaryId && <span className="rounded-full bg-slate-100 px-1.5 text-[10.5px] font-bold text-slate-600">CURRENT</span>}
                    {sel && <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-white">PRIMARY</span>}
                    {isSecondary && <span className="rounded-full bg-[#EDE9FE] px-1.5 text-[10.5px] font-bold text-[#6D28D9]">SECONDARY</span>}
                  </div>
                  <div className="truncate text-[12px] text-slate-500">
                    {[c.designation, ROLE_LABEL[c.role as Role] ?? c.role, c.employeeId].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right text-[18px] font-bold" style={{ color: tone.text }}>
                  {c.score}
                </div>
              </div>
              <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-slate-100">
                <div className="h-full" style={{ width: `${Math.min(100, c.score)}%`, background: tone.bar }} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {c.badges.map((b) => (
                  <Badge key={b} text={b} area={p.area} />
                ))}
              </div>
              <Strip busy={p.busy[c.id] ?? []} dayStartMs={p.dayStartMs} onDuty={c.availability === 'ON_DUTY'} />
            </div>
          )
        })}

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <span className="hc-label">Secondary staff (optional)</span>
            <select
              className="hc-input"
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                setSecondary((s) => {
                  const next = [...s, id]
                  setTeamSize((t) => Math.max(t, next.length + 1))
                  return next
                })
              }}
            >
              <option value="">{secondary.length ? 'Add another…' : 'None'}</option>
              {secondaryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {ROLE_LABEL[c.role as Role] ?? c.role}
                </option>
              ))}
            </select>
          </div>
          <label>
            <span className="hc-label">Fee (৳)</span>
            <input type="number" min={0} className="hc-input" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        </div>
        {secondary.length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {secondary.map((id) => (
              <span key={id} className="inline-flex h-7 items-center gap-1 rounded-full bg-[#EDE9FE] pl-2.5 pr-1 text-[12.5px] font-semibold text-[#6D28D9]">
                {all[id]?.name ?? 'Current team member'}
                <button type="button" className="flex size-5 items-center justify-center rounded-full hover:bg-white/60" onClick={() => setSecondary((s) => s.filter((x) => x !== id))} aria-label="Remove">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <label>
          <span className="hc-label">Instructions to staff</span>
          <input className="hc-input" value={instructions} placeholder="e.g. Bring resistance bands. Family requests female staff." onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="text-[13px]">
            <b>Notify via WhatsApp</b> <span className="text-slate-500">· staff_assigned template, opens on your phone</span>
          </div>
          <Toggle on={notify} onChange={setNotify} label="Notify via WhatsApp" />
        </div>
      </div>
    </Drawer>
  )
}
