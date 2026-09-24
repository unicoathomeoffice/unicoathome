// Pure helpers for the request detail (W04), assign drawer (W06) and visit report (E2). Server- and client-safe.
import { VITALS, TRANSITIONS, can, type Status } from '@/lib/constants'
import { dur, isoDay, minutesBetween, time } from '@/lib/format'

export type Sla = { confirmRoutineMin: number; confirmUrgentMin: number; assignMin: number; acceptTimeoutMin: number; lateAfterMin: number; overtimePct: number }

export type Metric = {
  key: string
  label: string
  /** minutes, or null when the step has not happened yet */
  value: number | null
  text: string
  target: string
  ok: boolean | null
  /** live metric: ISO time the clock started (rendered with <Elapsed>) */
  liveFrom?: string
}

const signed = (m: number) => (m === 0 ? 'on time' : `${m > 0 ? '+' : '−'}${dur(Math.abs(m))}`)

/** Plan §4.3 timing metrics. `all` adds turnaround and report lag (Timeline tab, reports). */
export function timingMetrics(r: any, sla: Sla, all = false): Metric[] {
  const t = r.timeline ?? {}
  const confirmTarget = r.priority === 'URGENT' ? sla.confirmUrgentMin : r.priority === 'EMERGENCY' ? 2 : sla.confirmRoutineMin
  const planned = r.expectedDurationMin ?? 45
  const maxDur = Math.round(planned * (1 + sla.overtimePct / 100))
  const m = (key: string, label: string, a: any, b: any, target: string, okFn: (v: number) => boolean, fmt: (v: number) => string = dur): Metric => {
    const v = minutesBetween(a, b)
    return { key, label, value: v, text: v == null ? '—' : fmt(v), target, ok: v == null ? null : okFn(v) }
  }
  const rows: Metric[] = [
    m('response', 'Response', t.requestedAt, t.confirmedAt, `≤ ${confirmTarget}`, (v) => v <= confirmTarget),
    m('assignment', 'Assignment', t.confirmedAt, t.assignedAt, `≤ ${sla.assignMin}`, (v) => v <= sla.assignMin),
    m('acceptance', 'Acceptance', t.assignedAt, t.acceptedAt, `≤ ${sla.acceptTimeoutMin}`, (v) => v <= sla.acceptTimeoutMin),
    m('punctuality', 'Punctuality', r.scheduledAt, t.checkInAt, `≤ +${sla.lateAfterMin}`, (v) => v <= sla.lateAfterMin, signed),
  ]
  const duration = m('duration', 'Visit duration', t.checkInAt, t.checkOutAt, `${planned} ± ${sla.overtimePct}%`, (v) => v <= maxDur)
  if (duration.value == null && t.checkInAt && r.status === 'IN_PROGRESS') {
    duration.liveFrom = new Date(t.checkInAt).toISOString()
    duration.ok = null
  }
  rows.push(duration)
  if (all) {
    const tat = r.priority === 'EMERGENCY' ? 120 : r.priority === 'URGENT' ? null : 48 * 60
    rows.push(
      m(
        'turnaround',
        'Turnaround',
        t.requestedAt,
        t.completedAt,
        r.priority === 'EMERGENCY' ? '≤ 2 h' : r.priority === 'URGENT' ? 'Same day' : '≤ 48 h',
        (v) => (tat == null ? isoDay(t.requestedAt) === isoDay(t.completedAt) : v <= tat),
      ),
      m('reportLag', 'Report lag', t.completedAt, t.closedAt, 'Same day', () => isoDay(t.completedAt) === isoDay(t.closedAt)),
    )
  }
  return rows
}

export type Step = { key: string; label: string; at?: string | null; sub?: string; state: 'done' | 'skipped' | 'current' | 'todo' | 'cancelled'; live?: string }

/** Horizontal lifecycle stepper (W04 overview). */
export function lifecycleSteps(r: any, sla: Sla): Step[] {
  const t = r.timeline ?? {}
  const list = r.visit?.checklist ?? []
  const done = list.filter((c: any) => c.done)
  const lastTick = done.map((c: any) => c.doneAt).filter(Boolean).sort().at(-1)
  const late = minutesBetween(r.scheduledAt, t.checkInAt)
  const raw: Omit<Step, 'state'>[] = [
    { key: 'requested', label: 'Requested', at: t.requestedAt },
    { key: 'verified', label: 'Verified', at: t.verifiedAt },
    { key: 'confirmed', label: 'Confirmed', at: t.confirmedAt },
    { key: 'assigned', label: 'Assigned', at: t.assignedAt },
    { key: 'accepted', label: 'Accepted', at: t.acceptedAt },
    { key: 'enroute', label: 'En route', at: t.enRouteAt },
    { key: 'checkin', label: 'Checked in', at: t.checkInAt, sub: t.checkInAt && late != null ? `${time(t.checkInAt)} · ${late > sla.lateAfterMin ? `+${late} min late` : late > 0 ? `+${late} min` : 'on time'}` : undefined },
    { key: 'checklist', label: `Checklist ${done.length}/${list.length}`, at: t.checkOutAt ? lastTick ?? t.checkOutAt : null },
    { key: 'checkout', label: 'Check-out', at: t.checkOutAt },
    { key: 'complete', label: 'Complete', at: t.completedAt },
    { key: 'closed', label: 'Closed', at: t.closedAt },
  ]
  const lastDone = raw.reduce((acc, s, i) => (s.at ? i : acc), -1)
  const cancelled = r.status === 'CANCELLED'
  let currentMarked = false
  return raw.map((s, i) => {
    if (s.at) return { ...s, state: 'done' as const }
    if (i < lastDone) return { ...s, state: 'skipped' as const, sub: 'skipped' }
    if (!currentMarked && r.status !== 'CLOSED') {
      currentMarked = true
      if (cancelled) return { ...s, key: 'cancelled', label: 'Cancelled', at: t.cancelledAt ?? r.cancellation?.at, state: 'cancelled' as const }
      if (s.key === 'checklist' && t.checkInAt) return { ...s, state: 'current' as const, live: new Date(t.checkInAt).toISOString() }
      return { ...s, state: 'current' as const, sub: 'now' }
    }
    return { ...s, state: 'todo' as const }
  })
}

// ---------------------------------------------------------------- vitals
export type VitalRow = { key: string; label: string; unit: string; value: string; abnormal: boolean }
export function vitalRows(v: any): VitalRow[] {
  if (!v) return []
  const out: VitalRow[] = []
  const ab = (k: string) => {
    const def = VITALS.find((d) => d.key === k)!
    const x = v[k]
    return k !== 'weightKg' && x != null && (x < def.min || x > def.max)
  }
  if (v.bpSys != null || v.bpDia != null) out.push({ key: 'bp', label: 'BP', unit: 'mmHg', value: `${v.bpSys ?? '—'}/${v.bpDia ?? '—'}`, abnormal: ab('bpSys') || ab('bpDia') })
  for (const d of VITALS) {
    if (d.key === 'bpSys' || d.key === 'bpDia') continue
    if (v[d.key] == null) continue
    const label = d.key === 'tempC' ? 'Temp' : d.label
    out.push({ key: d.key, label, unit: d.unit, value: d.key === 'weightKg' ? Number(v[d.key]).toFixed(1) : String(v[d.key]), abnormal: ab(d.key) })
  }
  return out
}

// ---------------------------------------------------------------- permissions for the action bar
export type Perms = { manage: boolean; assign: boolean; invoice: boolean; send: boolean; decide: boolean; edit: boolean }
export function permsFor(role: string): Perms {
  return {
    manage: can(role, 'requests.manage'),
    assign: can(role, 'requests.assign'),
    invoice: can(role, 'billing.invoice'),
    send: can(role, 'messages.send'),
    decide: can(role, 'approvals.decide'),
    edit: can(role, 'patients.edit'),
  }
}

/** Which lifecycle actions the header should offer for a status. */
export function availableActions(status: Status) {
  const next = TRANSITIONS[status] ?? []
  return {
    verify: status === 'NEW',
    confirm: ['NEW', 'VERIFIED', 'RESCHEDULED'].includes(status),
    assign: status === 'CONFIRMED',
    reassign: status === 'ASSIGNED' || status === 'ACCEPTED',
    reschedule: next.includes('RESCHEDULED'),
    cancel: next.includes('CANCELLED'),
    close: status === 'COMPLETED',
  }
}

export const ACTIVE_VISIT: string[] = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS']

export const GENDER: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' }

/** Map of user id → display info, built on the server from every id referenced by a request. */
export type People = Record<string, { name: string; initials: string; employeeId?: string; role?: string }>
export const who = (people: People, id: unknown) => (id ? people[String(id)]?.name ?? 'Unknown' : '—')
export const whoInitials = (people: People, id: unknown) => (id ? people[String(id)]?.initials ?? '?' : '')

export function collectUserIds(r: any): string[] {
  const ids = new Set<string>()
  const add = (x: unknown) => x && ids.add(String(x))
  add(r.createdBy)
  add(r.assignment?.assignedBy)
  add(r.assignment?.primaryStaffId)
  for (const s of r.assignment?.secondaryStaffIds ?? []) add(s)
  for (const d of r.assignment?.declines ?? []) add(d.staffId)
  for (const c of r.visit?.checklist ?? []) add(c.doneBy)
  add(r.visit?.vitals?.recordedBy)
  for (const m of r.visit?.medications ?? []) add(m.by)
  for (const p of r.pettyCash ?? []) {
    add(p.requestedBy)
    add(p.decidedBy)
  }
  add(r.billing?.collectedBy)
  add(r.billing?.reconciledBy)
  add(r.cancellation?.by)
  for (const x of r.reschedules ?? []) add(x.by)
  for (const x of r.deviceStamps ?? []) add(x.by)
  add(r.transport?.driverId)
  add(r.transport?.assignedBy)
  return [...ids]
}

export const bytes = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
