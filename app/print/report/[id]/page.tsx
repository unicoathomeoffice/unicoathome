// E2 Visit report — A4 printable page (outside the admin shell). Web users and anyone who can view the request (care team) can open it.
import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { Attachment, AuditLog, HomecareRequest, LabResult, Patient, User, isOid } from '@/lib/models'
import { canView, withPeople } from '@/lib/services/requests'
import { getSettings } from '@/lib/settings'
import { VisitReport } from '@/components/request-detail/VisitReport'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isOid(id)) return { title: 'Visit report' }
  await db()
  const r = await HomecareRequest.findById(id).select('requestNo').lean<any>()
  return { title: { absolute: r ? `Visit_report_${r.requestNo}` : 'Visit report' } }
}

export default async function VisitReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/print/report/${id}`)}`)
  await db()
  if (!isOid(id)) notFound()
  const r = await HomecareRequest.findOne({ _id: id, deletedAt: null }).lean<any>()
  if (!r || !canView(user, r)) notFound()
  await withPeople([r])
  const v = r.visit ?? {}
  const userIds = [...(v.checklist ?? []).map((c: any) => c.doneBy), ...(v.medications ?? []).map((m: any) => m.by), r.billing?.reconciledBy, r.assignment?.assignedBy].filter(Boolean).map(String).filter(isOid)
  const [settings, patient, labs, lastAudit, users, sig] = await Promise.all([
    getSettings(),
    Patient.findById(r.patientId).lean<any>(),
    LabResult.find({ requestId: r._id }).sort({ createdAt: 1 }).lean<any[]>(),
    AuditLog.findOne({ entity: 'request', entityId: id }).sort({ serverAt: -1 }).select('_id').lean<any>(),
    User.find({ _id: { $in: userIds } }).select('name').lean<any[]>(),
    v.confirmation?.attachmentId ? Attachment.findOne({ _id: v.confirmation.attachmentId, deletedAt: null }).select('_id').lean<any>() : null,
  ])
  const web = user.platformAccess.includes('web') && user.client === 'web'
  return (
    <VisitReport
      r={plain(r)}
      patient={plain(patient)}
      labs={plain(labs)}
      settings={settings}
      names={Object.fromEntries(users.map((u) => [String(u._id), u.name]))}
      signatureId={sig ? String(sig._id) : null}
      auditId={lastAudit ? String(lastAudit._id) : null}
      backHref={web ? `/requests/${id}?tab=visit` : `/m/visits/${id}`}
    />
  )
}
