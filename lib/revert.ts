// "Undo last step" on a request (pure — no imports, so it can be tested on its own). Each status steps back to the one
// before it and names the timeline stamps that step set, which are cleared. CANCELLED / RESCHEDULED go back to whatever
// the request was before (read from the audit log by the caller).

export type RevertPlan = { to: string; clear: string[]; step: string }

const STEP: Record<string, string> = {
  VERIFIED: 'Verified',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'On the way',
  IN_PROGRESS: 'Checked in',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  RESCHEDULED: 'Rescheduled',
}

/** Where "Undo" takes a request, or null when there is nothing to undo (NEW). */
export function revertTarget(r: { status: string; timeline?: Record<string, unknown> | null }, statusBefore?: string | null): RevertPlan | null {
  const t = r.timeline ?? {}
  const step = STEP[r.status]
  switch (r.status) {
    case 'VERIFIED':
      return { to: 'NEW', clear: ['verifiedAt'], step }
    case 'CONFIRMED':
      return { to: t.verifiedAt ? 'VERIFIED' : 'NEW', clear: ['confirmedAt'], step }
    case 'ASSIGNED':
      return { to: 'CONFIRMED', clear: ['assignedAt'], step }
    case 'ACCEPTED':
      return { to: 'ASSIGNED', clear: ['acceptedAt'], step }
    case 'EN_ROUTE':
      return { to: 'ACCEPTED', clear: ['enRouteAt'], step }
    case 'IN_PROGRESS':
      return { to: t.enRouteAt ? 'EN_ROUTE' : 'ACCEPTED', clear: ['checkInAt'], step }
    case 'COMPLETED':
      return { to: 'IN_PROGRESS', clear: ['checkOutAt', 'completedAt'], step }
    case 'CLOSED':
      return { to: 'COMPLETED', clear: ['closedAt'], step }
    case 'CANCELLED':
    case 'RESCHEDULED': {
      const to = statusBefore && statusBefore !== r.status && statusBefore in STEP_OR_NEW ? statusBefore : null
      return to ? { to, clear: [r.status === 'CANCELLED' ? 'cancelledAt' : 'rescheduledAt'], step } : null
    }
    default:
      return null
  }
}
const STEP_OR_NEW: Record<string, true> = { NEW: true, VERIFIED: true, CONFIRMED: true, ASSIGNED: true, ACCEPTED: true, EN_ROUTE: true, IN_PROGRESS: true, COMPLETED: true, RESCHEDULED: true }

export const STATUS_WORD: Record<string, string> = { NEW: 'New', ...STEP }
