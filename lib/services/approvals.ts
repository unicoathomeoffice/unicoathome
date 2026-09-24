import 'server-only'
import { z } from 'zod'
import { Approval, HomecareRequest, User, Session, isOid } from '../models'
import { APPROVAL_TYPES, ROLE_LABEL, can, type Role } from '../constants'
import { bad, conflict, forbidden, notFound } from '../api'
import { audit } from '../audit'
import { notifyRoles, notifyUsers } from '../messaging'
import { cancel, decidePettyCash, reschedule } from './requests'
import type { SessionUser } from '../auth'

type Meta = { ip?: string; userAgent?: string; client?: string }

export const APPROVAL_LABEL: Record<(typeof APPROVAL_TYPES)[number], string> = {
  NEW_USER: 'New user request',
  ROLE_CHANGE: 'Role change',
  RESCHEDULE: 'Reschedule request',
  CANCEL: 'Cancellation',
  HANDOVER: 'Handover request',
  PETTY_CASH: 'Petty cash',
  SERVICE_PROPOSAL: 'New service proposed',
}

export const DecideInput = z.object({
  approve: z.boolean(),
  note: z.string().max(500).optional(),
  /** RESCHEDULE only: override / supply the new date (YYYY-MM-DD) and slot */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  slot: z.string().optional(),
})
export type DecideInput = z.infer<typeof DecideInput>

/** Approval queue rows with requester, linked request and linked user joined in. */
export async function listApprovals(filter: { status?: string; type?: string; requestedBy?: string } = {}) {
  const f: Record<string, unknown> = {}
  if (filter.status && filter.status !== 'ALL') f.status = filter.status
  if (filter.type && (APPROVAL_TYPES as readonly string[]).includes(filter.type)) f.type = filter.type
  if (filter.requestedBy && isOid(filter.requestedBy)) f.requestedBy = filter.requestedBy
  const rows = await Approval.find(f).sort({ status: -1, createdAt: -1 }).limit(300).lean<any[]>()
  const userIds = new Set<string>()
  for (const a of rows) for (const id of [a.requestedBy, a.userId, a.decidedBy]) if (id) userIds.add(String(id))
  const [users, requests] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name role employeeId phone status platformAccess').lean<any[]>(),
    HomecareRequest.find({ _id: { $in: rows.map((a) => a.requestId).filter(Boolean) } })
      .select('requestNo status scheduledAt slot patientSnapshot.name services priority')
      .lean<any[]>(),
  ])
  const person = (id: unknown) => {
    const u = users.find((x) => String(x._id) === String(id))
    return u ? { id: String(u._id), name: u.name, role: u.role, employeeId: u.employeeId, status: u.status } : null
  }
  for (const a of rows) {
    a.requester = person(a.requestedBy)
    a.user = person(a.userId)
    a.decider = person(a.decidedBy)
    const r = requests.find((x) => String(x._id) === String(a.requestId))
    a.request = r
      ? { id: String(r._id), requestNo: r.requestNo, status: r.status, scheduledAt: r.scheduledAt, slot: r.slot, patient: r.patientSnapshot?.name, service: r.services?.[0]?.name, priority: r.priority }
      : null
  }
  return rows
}

async function loadLinkedRequest(a: any) {
  if (!a.requestId) throw bad('This approval is not linked to a request')
  const r = await HomecareRequest.findOne({ _id: a.requestId, deletedAt: null })
  if (!r) throw notFound('Linked request')
  return r
}

/**
 * Decide an approval and EXECUTE it:
 *   PETTY_CASH → decidePettyCash · NEW_USER → user ACTIVE / SUSPENDED · RESCHEDULE → reschedule() when a date is known
 *   CANCEL → cancel() · HANDOVER → coordinators asked to reassign · SERVICE_PROPOSAL / ROLE_CHANGE → decision recorded.
 * Every decision is audited and the requester is notified.
 */
export async function decideApproval(id: string, input: DecideInput, user: SessionUser, meta: Meta) {
  if (!can(user.role, 'approvals.decide')) throw forbidden()
  if (!isOid(id)) throw notFound('Approval')
  const a = await Approval.findById(id)
  if (!a) throw notFound('Approval')
  if (a.status !== 'PENDING') throw conflict('ALREADY_DECIDED', `Already ${String(a.status).toLowerCase()}`)
  const approve = input.approve
  const label = APPROVAL_LABEL[a.type as keyof typeof APPROVAL_LABEL] ?? a.type
  let followUp: string | undefined
  let requesterNotified = false
  let requestNo: string | undefined

  switch (a.type) {
    case 'PETTY_CASH': {
      const r = await loadLinkedRequest(a)
      requestNo = r.requestNo
      if (!a.payload?.pettyCashId) throw bad('Petty cash reference missing')
      await decidePettyCash(r, String(a.payload.pettyCashId), approve, user, meta) // notifies the requester itself
      requesterNotified = true
      break
    }
    case 'NEW_USER': {
      const u = a.userId ? await User.findById(a.userId) : null
      if (!u) throw notFound('User')
      const before = u.status
      u.status = approve ? 'ACTIVE' : 'SUSPENDED'
      await u.save()
      if (!approve) await Session.updateMany({ userId: u._id, revokedAt: null }, { revokedAt: new Date() })
      await audit(user, approve ? 'user.active' : 'user.suspended', 'user', u._id, { before: { status: before }, after: { status: u.status }, label: u.name }, meta)
      if (approve) followUp = `/staff?q=${encodeURIComponent(u.employeeId)}`
      break
    }
    case 'RESCHEDULE': {
      const r = await loadLinkedRequest(a)
      requestNo = r.requestNo
      if (approve) {
        const date = input.date ?? a.payload?.proposedDate
        const slot = input.slot ?? a.payload?.proposedSlot
        if (date) {
          await reschedule(r, { date, slot, reason: a.reason || 'Requested by staff' }, user, meta)
          followUp = `/requests/${r._id}?assign=1`
        } else {
          // No date proposed — approval recorded; the coordinator picks the new slot on the request.
          followUp = `/requests/${r._id}?reschedule=1`
          await notifyRoles(
            ['HC_ADMIN'],
            { type: 'APPROVAL', title: `Pick a new slot · ${r.requestNo}`, body: `Reschedule approved by ${user.name}${slot ? ` · proposed ${slot}` : ''}`, requestId: r._id, url: followUp },
            user.id,
          )
        }
      }
      break
    }
    case 'CANCEL': {
      const r = await loadLinkedRequest(a)
      requestNo = r.requestNo
      if (approve) {
        await cancel(r, { reason: a.reason && a.reason.length >= 2 ? a.reason : 'Cancelled on staff request' }, user, meta)
        followUp = `/requests/${r._id}`
      }
      break
    }
    case 'HANDOVER': {
      const r = await loadLinkedRequest(a)
      requestNo = r.requestNo
      if (approve) {
        followUp = `/requests/${r._id}?assign=1`
        await notifyRoles(['HC_ADMIN'], { type: 'APPROVAL', title: `Reassign ${r.requestNo}`, body: `Handover approved by ${user.name}: ${a.reason ?? ''}`, requestId: r._id, url: followUp, priority: 'high' }, user.id)
      }
      break
    }
    default:
      // SERVICE_PROPOSAL / ROLE_CHANGE: decision recorded; changes are applied by an admin in Settings.
      if (approve && a.type === 'SERVICE_PROPOSAL') followUp = '/settings/services'
      if (approve && a.type === 'ROLE_CHANGE') followUp = a.userId ? `/staff?edit=${a.userId}` : '/staff'
  }

  a.status = approve ? 'APPROVED' : 'REJECTED'
  a.decidedBy = user.id
  a.decidedAt = new Date()
  a.decisionNote = input.note || undefined
  await a.save()

  await audit(
    user,
    `approval.${approve ? 'approve' : 'reject'}`,
    'approval',
    a._id,
    { before: { status: 'PENDING' }, after: { status: a.status, type: a.type, note: input.note, date: input.date, slot: input.slot }, label: `${label}${requestNo ? ` · ${requestNo}` : ''}` },
    meta,
  )
  if (!requesterNotified && a.requestedBy) {
    await notifyUsers([a.requestedBy], {
      type: 'APPROVAL',
      title: `${label} ${approve ? 'approved' : 'rejected'}${requestNo ? ` · ${requestNo}` : ''}`,
      body: input.note || `Decided by ${user.name}`,
      requestId: a.requestId,
      url: a.requestId ? `/m/visits/${a.requestId}` : undefined,
    })
  }
  return { ok: true, status: a.status as string, followUp }
}

export function describeRole(role?: string) {
  return role ? (ROLE_LABEL[role as Role] ?? role) : ''
}
