import { route, qp } from '@/lib/api'
import { AssignmentLog, Attachment, AuditLog, MessageLog, User } from '@/lib/models'
import { loadRequest, revertPreview, withPeople } from '@/lib/services/requests'
import { notifyTimeline } from '@/lib/services/notify-log'
import { kitRows } from '@/lib/services/kit'
import { afterRows } from '@/lib/services/after-checklist'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'

const PHOTO_KINDS = ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO']
const PARTS = ['counts', 'assignment', 'attachments', 'photos', 'notified', 'undo', 'kit', 'after'] as const

/**
 * GET ?parts=assignment,attachments,… — the request-detail panels that the web page builds on the server
 * (app/(admin)/requests/[id]/page.tsx) and that GET /requests/:id does not include. Same access rule (canView);
 * the undo preview only for coordinators. `people` names every user id the rows mention.
 */
export const GET = route<{ id: string }>(async ({ req, user, params }) => {
  const doc = await loadRequest(params.id, user)
  const r = doc.toObject() as any
  const asked = (qp(req).get('parts') ?? PARTS.join(',')).split(',').filter((p): p is (typeof PARTS)[number] => (PARTS as readonly string[]).includes(p))
  const want = new Set(asked)
  const ids: unknown[] = []
  const out: Record<string, unknown> = {}

  await Promise.all([
    want.has('counts') &&
      Promise.all([
        MessageLog.countDocuments({ requestId: r._id }),
        Attachment.countDocuments({ requestId: r._id, deletedAt: null }),
        AuditLog.countDocuments({ entity: 'request', entityId: params.id }),
        AssignmentLog.countDocuments({ requestId: r._id }),
      ]).then(([messages, attachments, audit, assignment]) => (out.counts = { messages, attachments, audit, assignment })),
    want.has('assignment') &&
      AssignmentLog.find({ requestId: r._id }).sort({ at: -1 }).lean<any[]>().then((logs) => {
        for (const l of logs) ids.push(l.fromStaffId, l.toStaffId, l.by)
        out.assignment = logs
      }),
    want.has('attachments') &&
      Attachment.find({ requestId: r._id, deletedAt: null }).sort({ at: -1 }).lean<any[]>().then((atts) => {
        for (const a of atts) ids.push(a.uploadedBy)
        out.attachments = atts
      }),
    want.has('photos') &&
      Promise.all([
        Attachment.find({ requestId: r._id, deletedAt: null, kind: { $in: PHOTO_KINDS } }).sort({ at: 1 }).lean<any[]>(),
        r.visit?.confirmation?.attachmentId ? Attachment.findOne({ _id: r.visit.confirmation.attachmentId, deletedAt: null }).select('_id mime').lean<any>() : null,
      ]).then(([photos, signature]) => {
        out.photos = photos
        out.signature = signature
      }),
    want.has('notified') && notifyTimeline(r).then((steps) => (out.notified = steps)),
    want.has('undo') && can(user, 'requests.manage') && withPeople([r]).then(() => revertPreview(r)).then((u) => (out.undo = u ?? null)),
    want.has('kit') && kitRows(r).then((rows) => (out.kit = rows)),
    want.has('after') && afterRows(r).then((rows) => (out.after = rows)),
  ])

  const uniq = [...new Set(ids.filter(Boolean).map(String))]
  const people = uniq.length ? await User.find({ _id: { $in: uniq } }).select('name photoUrl role').lean<any[]>() : []
  out.people = Object.fromEntries(people.map((p) => [String(p._id), { name: p.name, photoUrl: p.photoUrl, role: p.role }]))
  return plain(out)
})
