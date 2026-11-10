import 'server-only'
import { z } from 'zod'
import { HomecareRequest, ServiceType } from '../models'
import { audit } from '../audit'
import { bad, conflict, forbidden, notFound } from '../api'
import { can } from '../constants'
import type { SessionUser } from '../auth'
import { isTeamMember } from './requests'

// After-return checklist: what the team does once back at the hospital — e.g. hand the samples to the lab, return
// unused medicine. Admins set it per service (Settings → Services); a service that never saved its own list uses the
// defaults below. Each request keeps its own copy (visit.afterChecklist); required items must be ticked before Close.

export type AfterItem = { key: string; label: string; mandatory: boolean; sortOrder?: number; withNote?: boolean; notePrompt?: string }
type Meta = { ip?: string; userAgent?: string; client?: string }

const has = (t: { code?: string; name?: string; category?: string }, rx: RegExp) => rx.test(`${t.code ?? ''} ${t.name ?? ''}`)

/** Built-in suggestions for a service that has no saved after-return list. */
export function defaultAfterChecklist(t: { code?: string; name?: string; category?: string }): AfterItem[] {
  const out: AfterItem[] = []
  const cat = (t.category ?? '').toLowerCase()
  if (has(t, /sample|phleb|blood|swab|specimen|urine|stool|culture/i)) { // by name: a Lab-category ECG has no samples
    out.push({ key: 'lab_handover', label: 'Samples handed over to lab', mandatory: true })
    out.push({ key: 'lab_receipt', label: 'Lab receipt / accession no.', mandatory: false, withNote: true, notePrompt: 'Receipt / accession no.' })
  }
  if (has(t, /inject|\biv\b|infus|medic|drip|cannula|vaccin/i)) out.push({ key: 'medicine_returned', label: 'Unused medicine returned to pharmacy', mandatory: true })
  if (cat === 'nursing' || has(t, /dress|wound|cathet|\bng\b|tube|suture|stitch|bed ?sore/i)) out.push({ key: 'waste_disposed', label: 'Used kit and clinical waste disposed', mandatory: true })
  out.push({ key: 'bag_restocked', label: 'Equipment bag returned and restocked', mandatory: false })
  return out.map((x, i) => ({ ...x, sortOrder: i }))
}

/** The service's own list once an admin saved it (even empty), otherwise the defaults. */
export const afterChecklistOf = (t: any): AfterItem[] =>
  (Array.isArray(t.afterChecklist) ? t.afterChecklist : defaultAfterChecklist(t)).map((c: any) => ({ key: c.key, label: c.label, mandatory: c.mandatory !== false, sortOrder: c.sortOrder, withNote: !!c.withNote, notePrompt: c.notePrompt || undefined }))

/** One list for a request with several services (same key = one item; required wins). */
export async function buildAfterChecklist(serviceTypeIds: unknown[]) {
  const types = await ServiceType.find({ _id: { $in: serviceTypeIds.filter(Boolean) } }).lean<any[]>()
  const out: AfterItem[] = []
  for (const t of types)
    for (const c of [...afterChecklistOf(t)].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      const hit = out.find((x) => x.key === c.key)
      if (hit) hit.mandatory ||= c.mandatory
      else out.push(c)
    }
  // the generic bag item goes last
  out.sort((a, b) => Number(a.key === 'bag_restocked') - Number(b.key === 'bag_restocked'))
  return out.map(({ sortOrder: _s, ...c }) => ({ ...c, done: false }))
}

/** Visits created before this list existed: build it from their services the first time it is needed. */
export async function ensureAfterChecklist(r: any) {
  if (r.visit?.afterSet) return r.visit.afterChecklist ?? []
  const list = await buildAfterChecklist((r.services ?? []).map((s: any) => s.serviceTypeId))
  await HomecareRequest.updateOne({ _id: r._id, 'visit.afterSet': { $ne: true } }, { $set: { 'visit.afterSet': true, 'visit.afterChecklist': list } })
  if (r.set) {
    r.set('visit.afterSet', true)
    r.set('visit.afterChecklist', list)
  } else {
    r.visit = { ...(r.visit ?? {}), afterSet: true, afterChecklist: list }
  }
  return list
}

/** Required items still open (blocks Close). */
export const openRequiredAfter = (r: any) => (r.visit?.afterChecklist ?? []).filter((c: any) => c.mandatory && !c.done)

export const AfterTickInput = z.object({ done: z.boolean(), note: z.string().max(200).optional(), reason: z.string().max(200).optional() })

/** Tick (or re-open) one after-return item: the care team after check-out, or a coordinator. */
export async function tickAfter(r: any, key: string, input: z.infer<typeof AfterTickInput>, user: SessionUser, meta: Meta = {}) {
  const coordinator = can(user, 'requests.manage') || can(user, 'requests.override')
  if (!isTeamMember(user, r) && !coordinator) throw forbidden('Only the care team or a coordinator can do this')
  if (!r.timeline?.checkOutAt) throw conflict('NOT_CHECKED_OUT', 'These are done after the visit — check out first')
  if (r.status === 'CANCELLED') throw conflict('CANCELLED', 'This visit was cancelled')
  await ensureAfterChecklist(r)
  const list: any[] = r.visit.afterChecklist
  const i = list.findIndex((c) => c.key === key)
  if (i < 0) throw notFound('Checklist item')
  const item = list[i]
  if (!input.done && item.done) {
    if (!coordinator) throw forbidden('Ask a coordinator to re-open a ticked item')
    if (!input.reason?.trim()) throw bad('Say why it is re-opened', { reason: 'Required' })
  }
  if (input.done && item.withNote && item.mandatory && !input.note?.trim() && !item.note) throw bad(`Add the ${item.notePrompt || 'note'}`, { note: 'Required' })
  const now = new Date()
  const set: Record<string, unknown> = input.done
    ? { [`visit.afterChecklist.${i}.done`]: true, [`visit.afterChecklist.${i}.doneAt`]: now, [`visit.afterChecklist.${i}.doneBy`]: user.id, ...(input.note != null ? { [`visit.afterChecklist.${i}.note`]: input.note.trim() } : {}) }
    : { [`visit.afterChecklist.${i}.done`]: false, [`visit.afterChecklist.${i}.reopenReason`]: input.reason?.trim() }
  await HomecareRequest.updateOne({ _id: r._id }, { $set: set, ...(input.done ? {} : { $unset: { [`visit.afterChecklist.${i}.doneAt`]: '', [`visit.afterChecklist.${i}.doneBy`]: '' } }) })
  await audit(user, input.done ? 'visit.after_check' : 'visit.after_reopen', 'request', r._id, { after: { item: item.label, note: input.note, reason: input.reason }, label: r.requestNo }, meta)
  return { ok: true }
}

/** Rows for the After-return card (built on first use for older visits), with who ticked each item. */
export async function afterRows(r: any) {
  const list: any[] = await ensureAfterChecklist(r)
  const ids = [...new Set(list.map((c) => c.doneBy).filter(Boolean).map(String))]
  const { User } = await import('../models')
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean<any[]>() : []
  return list.map((c) => ({
    key: c.key,
    label: c.label,
    mandatory: !!c.mandatory,
    withNote: !!c.withNote,
    notePrompt: c.notePrompt ?? undefined,
    done: !!c.done,
    doneAt: c.doneAt ? new Date(c.doneAt).toISOString() : null,
    doneByName: users.find((u) => String(u._id) === String(c.doneBy))?.name ?? null,
    note: c.note ?? null,
  }))
}
