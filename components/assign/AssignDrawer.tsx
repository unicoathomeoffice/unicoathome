'use client'
// W06 Assign drawer — schedule, care team (TeamPicker: ranked candidates), fee, instructions, "Notify on WhatsApp".
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { api, useAction, Drawer, Toggle, WhatsAppButton } from '@/components/client'
import { btnClass } from '@/components/ui'
import { NotifyPicker } from '@/components/client/NotifyPicker'
import { firstName, TeamPicker, type Candidate } from './TeamPicker'

export type { Candidate } from './TeamPicker'

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
  /** override access: may put the team on as already accepted (no waiting for Accept) */
  canOverride?: boolean
}

export function AssignDrawer(p: AssignProps) {
  const { run, busy } = useAction()
  // the care team in order: [0] is the primary (must accept), the rest are members. Reassign starts from the current team.
  const teamKey = [p.currentPrimaryId ?? '', ...p.currentSecondaryIds].join(',') // stable across parent re-renders
  const initialTeam = useMemo(() => teamKey.split(',').filter((x, i, a) => !!x && a.indexOf(x) === i), [teamKey])
  const [team, setTeam] = useState<string[]>(initialTeam)
  const [teamSize, setTeamSize] = useState(Math.min(5, Math.max(1, p.teamSize || 1, initialTeam.length)))
  const primary = team[0] ?? null
  const secondary = team.slice(1)
  const [date, setDate] = useState(p.date)
  const [slot, setSlot] = useState(p.slot)
  const [duration, setDuration] = useState(String(p.duration || 45))
  const [fee, setFee] = useState(p.fee?.toString() ?? '')
  const [instructions, setInstructions] = useState(p.instructions)
  const [notify, setNotify] = useState<string[] | null>(null)
  const [paired, setPaired] = useState(true)
  const [acceptNow, setAcceptNow] = useState(!!p.canOverride)
  const [done, setDone] = useState<null | { id: string; name: string; others: { id: string; name: string }[] }>(null)
  const [names, setNames] = useState<Record<string, string>>({})

  // every time it opens: start again from the request's current team
  useEffect(() => {
    if (!p.open) return
    setTeam(initialTeam)
    setTeamSize(Math.min(5, Math.max(1, p.teamSize || 1, initialTeam.length)))
  }, [p.open, initialTeam, p.teamSize])

  useEffect(() => {
    if (!p.open) setDone(null)
  }, [p.open])

  const dirtySchedule = date !== p.date || slot !== p.slot
  const nameOf = (id: string) => names[id] ?? 'Current team member'
  const onLoaded = (items: Candidate[]) => setNames((x) => ({ ...x, ...Object.fromEntries(items.map((c) => [c.id, c.name])) }))

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
            acceptNow: p.canOverride && acceptNow ? true : undefined,
            notify: notify ?? undefined,
          },
        }),
      `${p.reassign ? 'Reassigned' : 'Assigned'} to ${nameOf(primary)}${sec.length ? ` + ${sec.length}` : ''}${p.canOverride && acceptNow ? ' · accepted' : ''}`,
    )
    if (r === undefined) return
    // hospital WhatsApp not paired: nothing went out by itself — offer the wa.me buttons for the team
    if (!paired && notify?.length) setDone({ id: primary, name: nameOf(primary), others: sec.map((id) => ({ id, name: nameOf(id) })) })
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
          <div className="text-[17px] font-bold">
            {done.name} has been assigned{done.others.length ? ` with ${done.others.map((o) => o.name).join(', ')}` : ''}
          </div>
          <div className="max-w-sm text-[13px] text-slate-500">
            {p.canOverride && acceptNow ? 'Accepted on their behalf — they got a push and in-app card, no need to wait.' : `They got a push and in-app card and must accept within ${p.acceptTimeoutMin} min.`} The hospital WhatsApp is not paired — send the assignment from your phone.
          </div>
          <WhatsAppButton requestId={p.requestId} templateKey="staff_assigned" to="staff" staffId={done.id} kind="g" size="lg" className="mt-2 w-full max-w-xs">
            Notify {firstName(done.name)} via WhatsApp
          </WhatsAppButton>
          {done.others.map((o) => (
            <WhatsAppButton key={o.id} requestId={p.requestId} templateKey="staff_assigned" to="staff" staffId={o.id} kind="o" size="md" className="w-full max-w-xs">
              Notify {firstName(o.name)} (team) via WhatsApp
            </WhatsAppButton>
          ))}
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
          <span className="mr-auto text-[12px] text-slate-500">{p.canOverride && acceptNow ? 'Goes straight to Accepted' : `Staff must accept within ${p.acceptTimeoutMin} min`}</span>
          <button className={btnClass('o', 'md', 'h-10 px-[18px]')} onClick={p.onClose}>
            Cancel
          </button>
          <button className={btnClass('p', 'md', 'h-10 px-[18px]')} disabled={busy || !primary || !date} onClick={submit}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {team.length > 1 ? `${p.reassign ? 'Reassign' : 'Assign'} team of ${team.length}` : `${p.reassign ? 'Reassign to' : 'Assign'} ${primary ? nameOf(primary) : ''}`}
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

        <TeamPicker
          team={team}
          setTeam={setTeam}
          teamSize={teamSize}
          setTeamSize={setTeamSize}
          // every field role at once (a doctor visit can take a nurse or phlebotomist too); the role chips only filter the view
          load={() => api<{ items: Candidate[] }>(`/requests/${p.requestId}/candidates?limit=60`)}
          loadKey={p.requestId}
          area={p.area}
          currentPrimaryId={p.currentPrimaryId}
          busy={p.busy}
          dayStartMs={p.dayStartMs}
          onLoaded={onLoaded}
        />

        <label>
          <span className="hc-label">Fee (৳)</span>
          <input type="number" min={0} className="hc-input" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <label>
          <span className="hc-label">Instructions to staff</span>
          <input className="hc-input" value={instructions} placeholder="e.g. Bring resistance bands. Family requests female staff." onChange={(e) => setInstructions(e.target.value)} />
        </label>
        {p.canOverride && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[#FFFBEB] px-3 py-2.5 ring-1 ring-[#FDE68A]">
            <div className="text-[13px]">
              <b>Accept on their behalf</b> <span className="text-slate-600">· no waiting for the staff to tap Accept (override, audited)</span>
            </div>
            <Toggle on={acceptNow} onChange={setAcceptNow} label="Accept on their behalf" />
          </div>
        )}
        <NotifyPicker params={primary ? { events: ['ASSIGNED'], requestId: p.requestId, staffIds: team } : null} value={notify} onChange={setNotify} onPaired={setPaired} preview={{ templateKey: 'patient_assigned' }} />
      </div>
    </Drawer>
  )
}
