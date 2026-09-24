import 'server-only'
import { z } from 'zod'
import { Note, User, Designation, Patient, HomecareRequest, isOid } from '../models'
import { audit } from '../audit'
import { bad, forbidden, notFound } from '../api'
import { ADMIN_ROLES, NOTE_TYPES, NOTE_VISIBILITY } from '../constants'
import type { SessionUser } from '../auth'

type Meta = { ip?: string; userAgent?: string; client?: string }

const optId = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v == null || isOid(v), 'Invalid id')

export const NoteInput = z.object({
  type: z.enum(NOTE_TYPES).default('GENERAL'),
  text: z.string().trim().min(1, 'Write something first').max(4000),
  patientId: optId,
  requestId: optId,
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  visibility: z.enum(NOTE_VISIBILITY).default('TEAM'),
})
export const NotePatch = z.object({
  type: z.enum(NOTE_TYPES).optional(),
  text: z.string().trim().min(1).max(4000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  visibility: z.enum(NOTE_VISIBILITY).optional(),
})

export const isCoordinator = (u: Pick<SessionUser, 'role'>) => ADMIN_ROLES.includes(u.role)

/** Mongo filter for the notes a user may read: TEAM notes, COORDINATOR notes (coordinators/admins) and their own. */
export function visibleFilter(user: SessionUser) {
  const or: any[] = [{ visibility: 'TEAM' }, { authorId: user.id }]
  if (isCoordinator(user)) or.push({ visibility: 'COORDINATOR' })
  return { deletedAt: null, $or: or }
}

export type NoteFilters = { filter?: string; requestId?: string; patientId?: string; q?: string; limit?: number }

export async function listNotes(user: SessionUser, f: NoteFilters = {}) {
  const and: any[] = [visibleFilter(user)]
  if (f.filter === 'mine') and.push({ authorId: user.id })
  if (f.filter === 'patient') and.push({ type: 'PATIENT' })
  if (f.filter === 'handover') and.push({ type: 'HANDOVER' })
  if (f.filter === 'flagged') and.push({ tags: { $in: ['Red flag', 'Doctor review needed'] } })
  if (f.requestId && isOid(f.requestId)) and.push({ requestId: f.requestId })
  if (f.patientId && isOid(f.patientId)) and.push({ patientId: f.patientId })
  if (f.q?.trim()) and.push({ text: new RegExp(f.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
  const rows = await Note.find({ $and: and })
    .sort({ createdAt: -1 })
    .limit(Math.min(f.limit ?? 100, 300))
    .lean<any[]>()
  return decorate(rows, user)
}

/** Joins author (name, username, role, designation), patient and request number onto lean notes. */
export async function decorate(rows: any[], user: SessionUser) {
  const [authors, patients, requests] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.authorId)))] } })
      .select('name username role designationId employeeId')
      .lean<any[]>(),
    Patient.find({ _id: { $in: rows.map((r) => r.patientId).filter(Boolean) } })
      .select('name ageYears gender uhid')
      .lean<any[]>(),
    HomecareRequest.find({ _id: { $in: rows.map((r) => r.requestId).filter(Boolean) } })
      .select('requestNo patientSnapshot.name status')
      .lean<any[]>(),
  ])
  const desigs = await Designation.find({ _id: { $in: authors.map((a) => a.designationId).filter(Boolean) } })
    .select('title')
    .lean<any[]>()
  return rows.map((n) => {
    const a = authors.find((x) => String(x._id) === String(n.authorId))
    const p = patients.find((x) => String(x._id) === String(n.patientId))
    const r = requests.find((x) => String(x._id) === String(n.requestId))
    return {
      id: String(n._id),
      type: n.type,
      text: n.text,
      tags: n.tags ?? [],
      visibility: n.visibility,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      edited: n.updatedAt && n.createdAt && new Date(n.updatedAt).getTime() - new Date(n.createdAt).getTime() > 5000,
      mine: String(n.authorId) === user.id,
      author: a
        ? { id: String(a._id), name: a.name, username: a.username ?? a.employeeId, role: a.role, designation: desigs.find((d) => String(d._id) === String(a.designationId))?.title }
        : { id: String(n.authorId), name: 'Former user', username: '', role: '', designation: '' },
      patient: p ? { id: String(p._id), name: p.name, ageYears: p.ageYears, gender: p.gender, uhid: p.uhid } : null,
      request: r ? { id: String(r._id), requestNo: r.requestNo, patientName: r.patientSnapshot?.name, status: r.status } : null,
    }
  })
}

export async function createNote(input: z.infer<typeof NoteInput>, user: SessionUser, meta: Meta = {}) {
  let patientId = input.patientId
  if (input.requestId) {
    const r = await HomecareRequest.findOne({ _id: input.requestId, deletedAt: null }).select('patientId requestNo').lean<any>()
    if (!r) throw notFound('Visit')
    patientId = patientId ?? String(r.patientId)
  }
  if (patientId && !(await Patient.exists({ _id: patientId }))) throw notFound('Patient')
  if (input.type === 'PATIENT' && !patientId) throw bad('Pick the patient this note is about', { patientId: 'Required' })
  const n = await Note.create({ ...input, patientId, authorId: user.id })
  await audit(user, 'note.create', 'note', n._id, { after: { type: n.type, visibility: n.visibility, patientId, requestId: input.requestId, tags: n.tags }, label: n.text.slice(0, 60) }, meta)
  return n
}

async function own(id: string, user: SessionUser) {
  if (!isOid(id)) throw notFound('Note')
  const n = await Note.findOne({ _id: id, deletedAt: null })
  if (!n) throw notFound('Note')
  if (String(n.authorId) !== user.id) throw forbidden('You can only change your own notes')
  return n
}

export async function updateNote(id: string, input: z.infer<typeof NotePatch>, user: SessionUser, meta: Meta = {}) {
  const n = await own(id, user)
  const before = { type: n.type, text: n.text, tags: [...(n.tags ?? [])], visibility: n.visibility }
  for (const k of ['type', 'text', 'tags', 'visibility'] as const) if (input[k] != null) n.set(k, input[k])
  await n.save()
  await audit(user, 'note.update', 'note', n._id, { before, after: { type: n.type, text: n.text, tags: n.tags, visibility: n.visibility }, label: n.text.slice(0, 60) }, meta)
  return n
}

export async function deleteNote(id: string, user: SessionUser, meta: Meta = {}) {
  const n = await own(id, user)
  n.deletedAt = new Date()
  await n.save()
  await audit(user, 'note.delete', 'note', n._id, { before: { text: n.text, type: n.type }, label: n.text.slice(0, 60) }, meta)
}
