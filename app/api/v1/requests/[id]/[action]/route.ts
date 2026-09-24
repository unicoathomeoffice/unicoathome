import { z } from 'zod'
import { route, body, clientMeta, forbidden, notFound } from '@/lib/api'
import { can, type Permission } from '@/lib/constants'
import * as svc from '@/lib/services/requests'
import type { SessionUser } from '@/lib/auth'

type Ctx = { r: any; user: SessionUser; meta: ReturnType<typeof clientMeta>; req: any }
type Action = { perm?: Permission; schema?: z.ZodTypeAny; run: (c: Ctx, input: any) => Promise<unknown> }

/**
 * POST /api/v1/requests/:id/:action — every lifecycle step.
 * Coordinator: verify · confirm · assign · reschedule · cancel · close · invoice · petty-cash-decide · transport
 * Field staff: accept · decline · en-route · check-in · checklist-add · vitals · notes · medication · confirmation ·
 *              check-out · complete · petty-cash · change-request
 * Driver: transport-leg
 */
const ACTIONS: Record<string, Action> = {
  verify: { perm: 'requests.manage', run: ({ r, user, meta }) => svc.verify(r, user, meta) },
  confirm: { perm: 'requests.manage', schema: svc.ConfirmInput, run: ({ r, user, meta }, i) => svc.confirm(r, i, user, meta) },
  assign: { perm: 'requests.assign', schema: svc.AssignInput, run: ({ r, user, meta }, i) => svc.assign(r, i, user, meta) },
  reschedule: { perm: 'requests.manage', schema: svc.RescheduleInput, run: ({ r, user, meta }, i) => svc.reschedule(r, i, user, meta) },
  cancel: { perm: 'requests.manage', schema: svc.CancelInput, run: ({ r, user, meta }, i) => svc.cancel(r, i, user, meta) },
  close: { perm: 'billing.invoice', schema: svc.CloseInput, run: ({ r, user, meta }, i) => svc.close(r, i, user, meta) },
  invoice: { perm: 'billing.invoice', schema: svc.CloseInput.partial(), run: ({ r, user, meta }, i) => svc.saveInvoice(r, i, user, meta) },
  'petty-cash-decide': {
    perm: 'approvals.decide',
    schema: z.object({ pettyCashId: z.string(), approve: z.boolean() }),
    run: ({ r, user, meta }, i) => svc.decidePettyCash(r, i.pettyCashId, i.approve, user, meta),
  },
  transport: { perm: 'transport.manage', schema: svc.TransportInput, run: ({ r, user, meta }, i) => svc.assignTransport(r, i, user, meta) },
  'transport-leg': { schema: z.object({ leg: z.string() }), run: ({ r, user, meta }, i) => svc.stampTransportLeg(r, i.leg, user, meta) },

  accept: { schema: z.object({ deviceAt: z.string().optional() }), run: ({ r, user, meta }, i) => svc.accept(r, user, meta, i.deviceAt) },
  decline: { schema: svc.DeclineInput, run: ({ r, user, meta }, i) => svc.decline(r, i, user, meta) },
  'en-route': { schema: svc.StampInput, run: ({ r, user, meta }, i) => svc.enRoute(r, i, user, meta) },
  'check-in': { schema: svc.StampInput, run: ({ r, user, meta }, i) => svc.checkIn(r, i, user, meta) },
  'checklist-add': { schema: z.object({ label: z.string().min(2) }), run: ({ r, user, meta }, i) => svc.addChecklistItem(r, i.label, user, meta) },
  vitals: { schema: svc.VitalsInput, run: ({ r, user, meta }, i) => svc.saveVitals(r, i, user, meta) },
  notes: { schema: svc.NotesInput, run: ({ r, user, meta }, i) => svc.saveNotes(r, i, user, meta) },
  medication: { schema: svc.MedicationInput, run: ({ r, user, meta }, i) => svc.addMedication(r, i, user, meta) },
  confirmation: { schema: svc.ConfirmationInput, run: ({ r, user, meta }, i) => svc.patientConfirmation(r, i, user, meta) },
  'check-out': { schema: svc.CheckOutInput, run: ({ r, user, meta }, i) => svc.checkOut(r, i, user, meta) },
  complete: { run: ({ r, user, meta }) => svc.completeVisit(r, user, meta) },
  'petty-cash': { schema: svc.PettyCashInput, run: ({ r, user, meta }, i) => svc.requestPettyCash(r, i, user, meta) },
  'change-request': { schema: svc.StaffChangeInput, run: ({ r, user, meta }, i) => svc.staffChangeRequest(r, i, user, meta) },
}

export const POST = route<{ id: string; action: string }>(async ({ req, user, params }) => {
  const a = ACTIONS[params.action]
  if (!a) throw notFound('Action')
  if (a.perm && !can(user, a.perm)) throw forbidden()
  const r = await svc.loadRequest(params.id, user)
  const input = a.schema ? await body(req, a.schema) : {}
  const result = await a.run({ r, user, meta: clientMeta(req, user), req }, input)
  return { ok: true, status: r.status, version: r.version, result: result ?? null }
})
