import { notFound } from 'next/navigation'
import { AdminPage } from '@/components/admin/AdminPage'
import { AutoRefresh } from '@/components/client'
import { PriorityBadge, SlaPill, StatusChip, Tabs } from '@/components/ui'
import { requireWebUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { AssignmentLog, Attachment, AuditLog, ChatMessage, HomecareRequest, LabResult, MessageLog, Patient, Prescription, User, Vehicle, isOid } from '@/lib/models'
import { canView, slaInfo, withPeople } from '@/lib/services/requests'
import { getSettings } from '@/lib/settings'
import { initialsOf, isoDay, dayRange, dayNum, time, time24, dur, date } from '@/lib/format'
import { ROLE_LABEL, TRANSPORT_MODE_LABEL, can, canResendMessages, isCoordinator, type Role, type Status, patientCategoryLabel } from '@/lib/constants'
import { ActionBar, EditRequestButton, type ReqLite } from '@/components/request-detail/actions'
import { LivePill } from '@/components/request-detail/widgets'
import { AssignmentTab, AttachmentsTab, AuditTab, MessagesTab, OverviewTab, TimelineTab, VisitTab } from '@/components/request-detail/tabs'
import { ACTIVE_VISIT, availableActions, collectUserIds, permsFor, type People } from '@/components/request-detail/lib'
import type { AssignProps } from '@/components/assign/AssignDrawer'
import { isPaired } from '@/lib/wa/status'
import { h360Status } from '@/lib/h360'
import { ConfirmationStatus } from '@/components/request-detail/PatientWhatsApp'
import { LiveTrackingCard } from '@/components/request-detail/LiveTrackingCard'
import { VisitUpdateCard } from '@/components/request-detail/VisitUpdateCard'
import { InvoiceTab } from '@/components/request-detail/InvoiceTab'
import { TransportDocsBox } from '@/components/request-detail/TransportDocsBox'
import { RidesCard } from '@/components/request-detail/RidesCard'
import { liveView } from '@/lib/services/tracking'
import { OverridePanel } from '@/components/request-detail/OverridePanel'
import { H360BillingSheet } from '@/components/request-detail/H360BillingSheet'
import { TimeoutBanner } from '@/components/request-detail/TimeoutBanner'

export const metadata = { title: 'Request detail' }

const TABS = ['overview', 'timeline', 'assignment', 'visit', 'invoice', 'messages', 'attachments', 'audit'] as const
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
  const perms = permsFor(user)
  const status = r.status as Status
  const acts = availableActions(status)

  const [patient, msgCount, attCount, auditCount, logCount, waPaired, confirmMsg] = await Promise.all([
    Patient.findById(r.patientId).lean<any>(),
    MessageLog.countDocuments({ requestId: r._id }),
    Attachment.countDocuments({ requestId: r._id, deletedAt: null }),
    AuditLog.countDocuments({ entity: 'request', entityId: id }),
    AssignmentLog.countDocuments({ requestId: r._id }),
    isPaired(),
    // latest patient confirmation on WhatsApp (status card on Overview)
    MessageLog.findOne({ requestId: r._id, channel: 'WHATSAPP', templateKey: 'patient_confirmed' }).sort({ at: -1 }).select('status at error provider').lean<any>(),
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
  let billSent: any[] = []
  let h360On = false
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
  } else if (tab === 'invoice') {
    ;[billSent, h360On] = await Promise.all([
      MessageLog.find({ requestId: r._id, channel: 'WHATSAPP', templateKey: { $in: ['patient_bill', 'staff_bill'] } }).sort({ at: -1 }).limit(50).select('at toName to status error fileName').lean<any[]>(),
      h360Status().then((s) => s.configured),
    ])
  } else if (tab === 'audit') {
    audits = await AuditLog.find({ entity: 'request', entityId: id }).sort({ serverAt: -1 }).limit(500).lean<any[]>()
  }

  // ---- people referenced anywhere on the page
  const ids = [...new Set([...collectUserIds(r), ...extraIds.filter(Boolean).map(String)])].filter(isOid)
  const users = await User.find({ _id: { $in: ids } }).select('name employeeId role photoUrl').lean<any[]>()
  const people: People = Object.fromEntries(users.map((u) => [String(u._id), { name: u.name, initials: initialsOf(u.name), employeeId: u.employeeId, role: u.role, photoUrl: u.photoUrl }]))
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
      time: r.scheduledAt ? time24(r.scheduledAt) : r.preferred?.time || '', // HH:mm for the time input
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
      canOverride: can(user, 'requests.override'),
    }
  }

  // ---- "Act for the team" (override) + car & any driver
  const canOverride = can(user, 'requests.override')
  const canCar = canOverride || can(user, 'transport.manage')
  const carRelevant = canCar && r.transport?.needed // own transport can switch back to a car, so load cars either way
  const [carList, driverList] =
    carRelevant || canOverride
      ? await Promise.all([
          carRelevant ? Vehicle.find({ isActive: { $ne: false } }).sort({ name: 1 }).select('name plate driverId status').lean<any[]>() : [],
          carRelevant ? User.find({ status: 'ACTIVE', deletedAt: null, $or: [{ role: 'DRIVER' }, { roles: 'DRIVER' }] }).sort({ name: 1 }).select('name phone').lean<any[]>() : [],
        ])
      : [[], []]
  const hhmm = (d?: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '')
  const visitAt = r.scheduledAt ? new Date(r.scheduledAt) : null

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
    testItems: (r.testItems ?? []).map((t: any) => ({ code: t.code ?? '', name: t.name, price: t.price ?? 0, dept: t.dept })),
    patientCategory: (patient as any)?.category ?? undefined,
    date: r.scheduledAt ? isoDay(r.scheduledAt) : r.preferred?.date || isoDay(),
    time: r.scheduledAt ? time24(r.scheduledAt) : r.preferred?.time || '', // HH:mm for the time input
    slot: r.slot ?? r.preferred?.slot ?? '',
    expectedDurationMin: r.expectedDurationMin ?? 45,
    estimatedFee: r.billing?.estimatedFee ?? null,
    paymentMethod: r.billing?.method ?? null,
    transportNeeded: !!r.transport?.needed,
    uhid: patient?.uhid ?? r.patientSnapshot?.uhid ?? '',
    patientName: r.patientSnapshot?.name ?? patient?.name ?? '',
    patientEmail: patient?.email ?? null,
    wa: { paired: waPaired, phone: patient?.whatsapp || patient?.phone || r.patientSnapshot?.phone || '', optOut: patient?.consent?.whatsapp === false },
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
    ...(['NEW', 'VERIFIED', 'CANCELLED'].includes(status) && !(r.billing?.invoices ?? []).length ? [] : [{ key: 'invoice', label: `Invoice · ${(r.billing?.invoices ?? []).length}`, href: `${base}?tab=invoice` }]),
    { key: 'messages', label: `Messages · ${msgCount}`, href: `${base}?tab=messages` },
    { key: 'attachments', label: `Attachments · ${attCount}`, href: `${base}?tab=attachments` },
    { key: 'audit', label: `Audit · ${auditCount}`, href: `${base}?tab=audit` },
  ]

  const R = plain(r)
  const contactP = tab === 'messages' ? await Patient.findById(r.patientId).select('name email phone whatsapp').lean<any>() : null
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
        {!['NEW', 'VERIFIED', 'CANCELLED'].includes(status) && (
          <ConfirmationStatus requestId={id} wa={lite.wa} patientName={r.patientSnapshot?.name} last={confirmMsg ? { status: confirmMsg.status, at: new Date(confirmMsg.at).toISOString(), error: confirmMsg.error, provider: confirmMsg.provider } : null} />
        )}
        {status === 'ASSIGNED' && r.assignment?.timedOutAt && (
          <TimeoutBanner
            requestId={id}
            requestNo={r.requestNo}
            staffName={r.primaryStaff?.name ?? 'The staff member'}
            since={new Date(r.assignment.timedOutAt).toISOString()}
            windowMin={sla.acceptTimeoutMin}
            canOverride={canOverride}
            canAssign={perms.assign}
          />
        )}
        <OverridePanel
          requestId={id}
          requestNo={r.requestNo}
          status={status}
          staffName={r.primaryStaff?.name ?? null}
          canOverride={canOverride}
          canCar={canCar}
          transport={{
            needed: !!r.transport?.needed,
            mode: r.transport?.mode ?? null,
            vehicleId: r.transport?.vehicleId ? String(r.transport.vehicleId) : null,
            driverId: r.transport?.driverId ? String(r.transport.driverId) : null,
            pickup: hhmm(r.transport?.pickupAt ? new Date(r.transport.pickupAt) : visitAt ? new Date(visitAt.getTime() - 40 * 60_000) : null),
            ret: hhmm(r.transport?.returnAt ? new Date(r.transport.returnAt) : visitAt ? new Date(visitAt.getTime() + ((r.expectedDurationMin ?? 45) + 60) * 60_000) : null),
          }}
          cars={carList.map((c: any) => ({ id: String(c._id), name: c.name, plate: c.plate, driverId: c.driverId ? String(c.driverId) : undefined, status: c.status }))}
          drivers={driverList.map((d: any) => ({ id: String(d._id), name: d.name, phone: d.phone }))}
          openChecklist={(r.visit?.checklist ?? []).filter((c: any) => c.mandatory && !c.done).length}
          team={[r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean).map((t: any) => ({ id: String(t.id), name: t.name }))}
          area={r.patientSnapshot?.area}
          defaultAmount={(settings.transportDocs as any)?.pettyCash?.defaultAmount}
          cashGiven={(() => {
            const g = [...(r.pettyCash ?? [])].reverse().find((x: any) => x.voucherNo && x.status === 'APPROVED')
            return g ? { amount: g.amount, mode: g.mode } : null
          })()}
        />
        {tab === 'overview' && r.transport?.needed && (!r.transport.mode || r.transport.mode === 'UNICO_CAR') && status !== 'CANCELLED' && (
          <TransportDocsBox
            requestId={id}
            requisitionId={r.transport.requisitionId ? String(r.transport.requisitionId) : null}
            gatePassId={r.transport.gatePassId ? String(r.transport.gatePassId) : null}
            sentAt={r.transport.requisitionSentAt ? new Date(r.transport.requisitionSentAt).toISOString() : null}
            sent={plain(await MessageLog.find({ requestId: r._id, channel: 'WHATSAPP', templateKey: { $in: ['vehicle_requisition', 'gate_pass'] } }).sort({ at: -1 }).limit(20).select('to status at templateKey').lean<any[]>())}
            canSend={can(user, 'requests.manage') || can(user, 'transport.manage')}
            requestNo={r.requestNo}
            to={(settings.transportDocs?.supervisors ?? []).filter((x: any) => x.active !== false && x.phone).map((x: any) => ({ name: x.name, phone: x.phone }))}
            linked={waPaired}
          />
        )}
        {tab === 'overview' && r.transport?.mode !== 'UNICO_CAR' && ((r.rides ?? []).length > 0 || ['ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'].includes(status)) && (
          <RidesCard
            requestId={id}
            rides={plain(r.rides ?? [])}
            team={[r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean).map((p: any) => ({ id: String(p.id), name: p.name }))}
            me={user.id}
            canPickPayer={can(user, 'requests.manage')}
          />
        )}
        {tab === 'overview' && r.tracking?.phase && (
          <LiveTrackingCard
            requestId={id}
            initial={plain(await liveView(r))}
            staffName={people[String(r.tracking.userId)]?.name ?? r.primaryStaff?.name ?? 'Staff'}
            times={plain({ left: t.enRouteAt ?? null, arrived: t.checkInAt ?? null, out: t.checkOutAt ?? null, back: r.returnTrip?.reachedAt ?? null, backBy: r.returnTrip?.reachedBy ?? null, returnKm: r.returnTrip?.distanceKm ?? null })}
          />
        )}
        {tab === 'overview' && t.checkInAt && (
          <VisitUpdateCard requestId={id} waPaired={waPaired} canSend={can(user, 'messages.send')} autoSentAt={r.visit?.updateSentAt ? new Date(r.visit.updateSentAt).toISOString() : null} />
        )}
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
        {tab === 'messages' && (
          <MessagesTab
            msgs={plain(msgs)}
            chat={plain(chat)}
            people={people}
            canResend={canResendMessages(user)}
            compose={{ requestId: id, contact: { name: contactP?.name ?? r.patientSnapshot?.name, email: contactP?.email, phone: contactP?.whatsapp ?? contactP?.phone ?? r.patientSnapshot?.phone }, whatsappLive: waPaired }}
          />
        )}
        {tab === 'invoice' && (
          <H360BillingSheet
            uhid={patient?.uhid ?? r.patientSnapshot?.uhid ?? ''}
            category={patientCategoryLabel(patient?.category)}
            items={(r.testItems ?? []).map((t: any) => ({ code: t.code ?? '', name: t.name, price: t.price ?? 0, dept: t.dept }))}
            plain={(r.tests ?? []).filter((n: string) => !(r.testItems ?? []).some((t: any) => t.name === n))}
            services={(r.services ?? []).map((s: any) => s.name)}
          />
        )}
        {tab === 'invoice' && (
          <InvoiceTab
            requestId={id}
            billing={plain({ status: r.billing?.status ?? null, override: r.billing?.statusOverride ?? null, payable: r.billing?.invoiceAmount ?? 0, paid: r.billing?.paidAmount ?? 0, due: r.billing?.dueAmount ?? 0, invoices: r.billing?.invoices ?? [], estimatedFee: r.billing?.estimatedFee ?? null })}
            team={[r.primaryStaff, ...(r.secondaryStaff ?? []), r.driver].filter(Boolean).map((p: any) => ({ id: p.id, name: p.name, role: p.role, phone: p.phone }))}
            patient={{ name: r.patientSnapshot?.name ?? '', phone: lite.wa.phone, optOut: lite.wa.optOut }}
            sent={plain(billSent)}
            canEdit={can(user, 'billing.invoice')}
            canSend={can(user, 'billing.invoice') && can(user, 'messages.send')}
            waPaired={waPaired}
            h360={h360On}
            patientUhid={patient?.uhid ?? r.patientSnapshot?.uhid ?? ''}
          />
        )}
        {tab === 'attachments' && <AttachmentsTab requestId={id} atts={plain(atts)} people={people} canUpload={perms.edit} me={{ id: user.id, admin: isCoordinator(user) }} />}
        {tab === 'audit' && <AuditTab rows={plain(audits)} />}
      </div>
    </AdminPage>
  )
}
