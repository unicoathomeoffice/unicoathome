import { notFound } from 'next/navigation'
import { AdminPage } from '@/components/admin/AdminPage'
import { AutoRefresh } from '@/components/client'
import { PriorityBadge, SlaPill, StatusChip, Tabs } from '@/components/ui'
import { requireWebUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { AssignmentLog, Attachment, AuditLog, ChatMessage, HomecareRequest, LabResult, MessageLog, Patient, Prescription, User, isOid } from '@/lib/models'
import { canView, slaInfo, withPeople } from '@/lib/services/requests'
import { getSettings } from '@/lib/settings'
import { initialsOf, isoDay, dayRange, dayNum, time, dur, date } from '@/lib/format'
import { ROLE_LABEL, TRANSPORT_MODE_LABEL, type Role, type Status } from '@/lib/constants'
import { ActionBar, EditRequestButton, type ReqLite } from '@/components/request-detail/actions'
import { LivePill } from '@/components/request-detail/widgets'
import { AssignmentTab, AttachmentsTab, AuditTab, MessagesTab, OverviewTab, TimelineTab, VisitTab } from '@/components/request-detail/tabs'
import { ACTIVE_VISIT, availableActions, collectUserIds, permsFor, type People } from '@/components/request-detail/lib'
import type { AssignProps } from '@/components/assign/AssignDrawer'

export const metadata = { title: 'Request detail' }

const TABS = ['overview', 'timeline', 'assignment', 'visit', 'messages', 'attachments', 'audit'] as const
type Tab = (typeof TABS)[number]
const PHOTO_KINDS = ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO']

export default async function RequestDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireWebUser()
  const { id } = await params
  const sp = await searchParams
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'overview'
  await db()
  if (!isOid(id)) notFound()
  const r = await HomecareRequest.findOne({ _id: id, deletedAt: null }).lean<any>()
  if (!r || !canView(user, r)) notFound()
  await withPeople([r])

  const settings = await getSettings()
  const sla = settings.sla
  const perms = permsFor(user.role)
  const status = r.status as Status
  const acts = availableActions(status)

  const [patient, msgCount, attCount, auditCount, logCount] = await Promise.all([
    Patient.findById(r.patientId).lean<any>(),
    MessageLog.countDocuments({ requestId: r._id }),
    Attachment.countDocuments({ requestId: r._id, deletedAt: null }),
    AuditLog.countDocuments({ entity: 'request', entityId: id }),
    AssignmentLog.countDocuments({ requestId: r._id }),
  ])

  // ---- tab data (only what the open tab needs)
  let logs: any[] = []
  let msgs: any[] = []
  let chat: any[] = []
  let atts: any[] = []
  let audits: any[] = []
  let photos: any[] = []
  let signature: any = null
  let prescriptions: any[] = []
  let labs: any[] = []
  let staffWa: any = null
  const extraIds: unknown[] = []
  if (tab === 'overview') {
    staffWa = await MessageLog.findOne({ requestId: r._id, channel: 'WHATSAPP', templateKey: 'staff_assigned', status: { $in: ['SENT_CONFIRMED', 'SENT', 'DELIVERED'] } })
      .sort({ at: -1 })
      .select('at')
      .lean<any>()
  } else if (tab === 'assignment') {
    logs = await AssignmentLog.find({ requestId: r._id }).sort({ at: -1 }).lean<any[]>()
    for (const l of logs) extraIds.push(l.fromStaffId, l.toStaffId, l.by)
  } else if (tab === 'visit') {
    ;[photos, prescriptions, labs] = await Promise.all([
      Attachment.find({ requestId: r._id, deletedAt: null, kind: { $in: PHOTO_KINDS } }).sort({ at: 1 }).lean<any[]>(),
      Prescription.find({ requestId: r._id }).sort({ createdAt: -1 }).lean<any[]>(),
      LabResult.find({ requestId: r._id }).sort({ createdAt: 1 }).lean<any[]>(),
    ])
    if (r.visit?.confirmation?.attachmentId) signature = await Attachment.findOne({ _id: r.visit.confirmation.attachmentId, deletedAt: null }).select('_id mime').lean<any>()
  } else if (tab === 'messages') {
    ;[msgs, chat] = await Promise.all([MessageLog.find({ requestId: r._id }).sort({ at: -1 }).limit(200).lean<any[]>(), ChatMessage.find({ requestId: r._id }).sort({ createdAt: 1 }).limit(300).lean<any[]>()])
    for (const m of msgs) extraIds.push(m.initiatedBy)
    for (const c of chat) extraIds.push(c.senderId)
  } else if (tab === 'attachments') {
    atts = await Attachment.find({ requestId: r._id, deletedAt: null }).sort({ at: -1 }).lean<any[]>()
    for (const a of atts) extraIds.push(a.uploadedBy)
  } else if (tab === 'audit') {
    audits = await AuditLog.find({ entity: 'request', entityId: id }).sort({ serverAt: -1 }).limit(500).lean<any[]>()
  }

  // ---- people referenced anywhere on the page
  const ids = [...new Set([...collectUserIds(r), ...extraIds.filter(Boolean).map(String)])].filter(isOid)
  const users = await User.find({ _id: { $in: ids } }).select('name employeeId role').lean<any[]>()
  const people: People = Object.fromEntries(users.map((u) => [String(u._id), { name: u.name, initials: initialsOf(u.name), employeeId: u.employeeId, role: u.role }]))
  for (const m of msgs) m.initiatedByName = m.initiatedBy ? people[String(m.initiatedBy)]?.name ?? 'Unknown' : 'System'

  // ---- assign drawer (W06)
  let assign: Omit<AssignProps, 'open' | 'onClose'> | null = null
  if (perms.assign && (acts.assign || acts.reassign)) {
    const day = isoDay(r.scheduledAt ?? new Date())
    const { start, end } = dayRange(day)
    const todays = await HomecareRequest.find({ _id: { $ne: r._id }, deletedAt: null, scheduledAt: { $gte: start, $lt: end }, status: { $in: ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'] } })
      .select('assignment scheduledAt expectedDurationMin')
      .lean<any[]>()
    const busy: Record<string, [number, number][]> = {}
    for (const t of todays) {
      const s = new Date(t.scheduledAt).getTime()
      const iv: [number, number] = [s, s + (t.expectedDurationMin ?? 45) * 60_000]
      for (const sid of [t.assignment?.primaryStaffId, ...(t.assignment?.secondaryStaffIds ?? [])].filter(Boolean).map(String)) (busy[sid] ??= []).push(iv)
    }
    assign = {
      requestId: id,
      requestNo: r.requestNo,
      sub: [r.requestNo, r.patientSnapshot?.name, (r.services ?? []).map((s: any) => s.name).join(', '), r.patientSnapshot?.area].filter(Boolean).join(' · '),
      area: r.patientSnapshot?.area ?? '',
      reassign: acts.reassign,
      date: r.scheduledAt ? isoDay(r.scheduledAt) : r.preferred?.date || isoDay(),
      time: r.scheduledAt ? time(r.scheduledAt) : r.preferred?.time || '',
      slot: r.slot ?? '',
      duration: r.expectedDurationMin ?? 45,
      fee: r.billing?.estimatedFee ?? null,
      instructions: r.assignment?.instructions ?? '',
      teamSize: r.assignment?.teamSize ?? 1,
      currentPrimaryId: r.assignment?.primaryStaffId ? String(r.assignment.primaryStaffId) : null,
      currentSecondaryIds: (r.assignment?.secondaryStaffIds ?? []).map(String),
      busy,
      dayStartMs: start.getTime(),
      acceptTimeoutMin: sla.acceptTimeoutMin,
      slots: settings.general.slots,
    }
  }

  // ---- compact request for client dialogs
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean).map((s: any) => s.name)
  const t = r.timeline ?? {}
  const lite: ReqLite = {
    id,
    requestNo: r.requestNo,
    status,
    version: r.version ?? 0,
    priority: r.priority,
    tests: r.tests ?? [],
    date: r.scheduledAt ? isoDay(r.scheduledAt) : r.preferred?.date || isoDay(),
    time: r.scheduledAt ? time(r.scheduledAt) : r.preferred?.time || '',
    slot: r.slot ?? r.preferred?.slot ?? '',
    expectedDurationMin: r.expectedDurationMin ?? 45,
    estimatedFee: r.billing?.estimatedFee ?? null,
    paymentMethod: r.billing?.method ?? null,
    transportNeeded: !!r.transport?.needed,
    uhid: patient?.uhid ?? r.patientSnapshot?.uhid ?? '',
    patientName: r.patientSnapshot?.name ?? patient?.name ?? '',
    patientEmail: patient?.email ?? null,
    primaryStaffId: r.primaryStaff?.id ?? null,
    primaryStaffName: r.primaryStaff?.name ?? null,
    complaint: r.clinical?.complaint ?? '',
    instructions: r.assignment?.instructions ?? '',
    remarks: r.remarks ?? '',
    rescheduled: (r.reschedules ?? []).length > 0,
    billing: {
      billAmount: r.billing?.billAmount ?? null,
      status: r.billing?.status ?? null,
      method: r.billing?.method ?? null,
      invoiceNo: r.billing?.invoiceNo ?? '',
      invoiceAmount: r.billing?.invoiceAmount ?? null,
      invoicePrinted: r.billing?.invoicePrinted ?? null,
    },
    pettyCash: (r.pettyCash ?? []).map((p: any) => ({
      id: String(p._id),
      amount: p.amount,
      purpose: p.purpose,
      by: people[String(p.requestedBy)]?.name ?? 'Staff',
      byInitials: people[String(p.requestedBy)]?.initials ?? '?',
      at: p.requestedAt ? time(p.requestedAt) : null,
      status: p.status,
    })),
    summary: {
      team: team.join(' · '),
      time: t.checkInAt ? `${time(t.checkInAt)} – ${time(t.checkOutAt)} · ${dur(r.visit?.durationMin)}${r.visit?.lateMin > sla.lateAfterMin ? ` · ${r.visit.lateMin} min late` : ' · on time'}` : '',
      tests: (r.tests ?? []).join(' · '),
      transport: r.transport?.mode ? [TRANSPORT_MODE_LABEL[r.transport.mode as 'UNICO_CAR'], r.vehicle?.name, r.driver?.name].filter(Boolean).join(' · ') : r.transport?.needed ? 'Requested' : 'Own',
      report: r.visit?.reportAt ? `Submitted ${time(r.visit.reportAt)} · ${date(r.visit.reportAt)}` : '',
    },
  }

  const reportHref = t.checkInAt || ['COMPLETED', 'CLOSED'].includes(status) ? `/print/report/${id}` : null
  const sla0 = slaInfo(r, settings)
  const created = r.createdAt ?? t.requestedAt
  const creator = r.createdByUser ? `${r.createdByUser.name}${r.createdByUser.role ? `, ${ROLE_LABEL[r.createdByUser.role as Role] ?? r.createdByUser.role}` : ''}` : 'web form'
  const base = `/requests/${id}`
  const tabItems = [
    { key: 'overview', label: 'Overview', href: base },
    { key: 'timeline', label: 'Timeline', href: `${base}?tab=timeline` },
    { key: 'assignment', label: 'Assignment', href: `${base}?tab=assignment` },
    { key: 'visit', label: 'Visit data', href: `${base}?tab=visit` },
    { key: 'messages', label: `Messages · ${msgCount}`, href: `${base}?tab=messages` },
    { key: 'attachments', label: `Attachments · ${attCount}`, href: `${base}?tab=attachments` },
    { key: 'audit', label: `Audit · ${auditCount}`, href: `${base}?tab=audit` },
  ]

  const R = plain(r)
  return (
    <AdminPage title={r.requestNo}>
      {ACTIVE_VISIT.includes(status) && <AutoRefresh seconds={20} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={status} />
            <PriorityBadge priority={r.priority} />
            {status === 'IN_PROGRESS' && t.checkInAt ? <LivePill from={new Date(t.checkInAt).toISOString()} planned={r.expectedDurationMin ?? 45} /> : sla0 && <SlaPill tone={sla0.tone} label={sla0.label} />}
            {status === 'CANCELLED' && r.cancellation?.reason && <span className="text-[13px] font-semibold text-[#B91C1C]">{r.cancellation.reason}</span>}
          </div>
          <div className="ml-auto">
            <ActionBar r={lite} perms={perms} slots={settings.general.slots} assign={assign} assignOpen={sp.assign === '1' && !!assign} reportHref={reportHref} />
          </div>
        </div>
        <div className="-mt-2 text-[13px] text-slate-500">
          Created {dayNum(created)} {time(created)} by {creator} ({String(r.source ?? 'phone').toLowerCase().replace('_', '-')}) · version {r.version ?? 0} · {r.patientSnapshot?.name} · {(r.services ?? []).map((s: any) => s.name).join(', ')}
        </div>
        <Tabs items={tabItems} active={tab} />
        {tab === 'overview' && (
          <OverviewTab
            r={R}
            patient={plain(patient)}
            people={people}
            sla={sla}
            edit={perms.edit && !['CLOSED', 'CANCELLED'].includes(status) ? <EditRequestButton r={lite} /> : undefined}
            photoCount={(r.visit?.photoIds ?? []).length}
            staffWhatsAppAt={staffWa?.at ? new Date(staffWa.at).toISOString() : null}
            historyCount={logCount}
          />
        )}
        {tab === 'timeline' && <TimelineTab r={R} people={people} sla={sla} />}
        {tab === 'assignment' && <AssignmentTab r={R} people={people} logs={plain(logs)} />}
        {tab === 'visit' && <VisitTab r={R} people={people} photos={plain(photos)} signature={plain(signature)} prescriptions={plain(prescriptions)} labs={plain(labs)} canDecide={perms.decide} reportHref={reportHref} />}
        {tab === 'messages' && <MessagesTab msgs={plain(msgs)} chat={plain(chat)} people={people} canResend={['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK'].includes(user.role)} />}
        {tab === 'attachments' && <AttachmentsTab requestId={id} atts={plain(atts)} people={people} canUpload={perms.edit} me={{ id: user.id, admin: ['SUPER_ADMIN', 'HC_ADMIN'].includes(user.role) }} />}
        {tab === 'audit' && <AuditTab rows={plain(audits)} />}
      </div>
    </AdminPage>
  )
}
