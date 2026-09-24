import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Phone, Plus, FileText, Image as ImageIcon, FlaskConical, CalendarClock } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { Patient, HomecareRequest, Attachment, Note, LabResult, CarePlan, ServiceType, User, Zone, isOid } from '@/lib/models'
import { ACTIVE_STATUSES, can } from '@/lib/constants'
import { withPeople } from '@/lib/services/requests'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Card, CardHeader, LinkButton, StatusChip, Tabs, Tag, Table, Tr, btnClass, telUrl } from '@/components/ui'
import { WhatsAppButton } from '@/components/client'
import { PatientDrawerButton } from '@/components/people/PatientDrawer'
import { UploadDocButton } from '@/components/people/UploadDocButton'
import { maskPhone } from '@/components/people/patient-board'
import { ago, cx, date, dayNum, dateTime, minutesBetween, phone as fmtPhone, taka, time } from '@/lib/format'

type P = Promise<{ id: string }>
type SP = Promise<Record<string, string | undefined>>

export const metadata = { title: 'Patient · Unico HomeCare' }

const GENDER: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const VCOLS = '124px minmax(110px,1.3fr) 104px minmax(90px,1fr) 118px minmax(120px,1.2fr)'

function visitTimes(v: any) {
  const inAt = v.timeline?.checkInAt
  const outAt = v.timeline?.checkOutAt
  if (v.status === 'CANCELLED') return v.cancellation?.reason ?? 'Cancelled'
  if (v.status === 'IN_PROGRESS' && inAt) return `in ${time(inAt)} · ${minutesBetween(inAt, new Date())} min so far`
  if (inAt && outAt) {
    const late = v.visit?.lateMin
    return `${time(inAt)}–${time(outAt)} · ${minutesBetween(inAt, outAt)} min${late && late > 0 ? ` · +${late} late` : ''}`
  }
  if (v.status === 'EN_ROUTE') return `en route ${time(v.timeline?.enRouteAt)}`
  if (!v.scheduledAt) return `requested ${time(v.timeline?.requestedAt ?? v.createdAt)}`
  return v.slot ? `slot ${v.slot}` : '—'
}

export default async function PatientProfile({ params, searchParams }: { params: P; searchParams: SP }) {
  const user = await requireWebUser('requests.readAll')
  const { id } = await params
  const sp = await searchParams
  if (!isOid(id)) notFound()
  const patient = await Patient.findOne({ _id: id, deletedAt: null }).lean<any>()
  if (!patient) notFound()

  const coordinatorView = can(user, 'requests.manage')
  const visits = await HomecareRequest.find({ patientId: id, deletedAt: null }).select('-deviceStamps -visit.checklist -visit.medications').sort({ createdAt: -1 }).limit(200).lean<any[]>()
  await withPeople(visits)
  const [documents, notes, labs, plans, zones] = await Promise.all([
    Attachment.find({ $or: [{ ownerType: 'PATIENT', ownerId: id }, { requestId: { $in: visits.map((v) => v._id) } }], deletedAt: null, kind: { $ne: 'SIGNATURE' } })
      .sort({ at: -1 })
      .limit(60)
      .lean<any[]>(),
    Note.find({ patientId: id, deletedAt: null, $or: [{ visibility: 'TEAM' }, { authorId: user.id }, ...(coordinatorView ? [{ visibility: 'COORDINATOR' }] : [])] })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean<any[]>(),
    LabResult.find({ patientId: id }).sort({ createdAt: -1 }).limit(40).lean<any[]>(),
    CarePlan.find({ patientId: id }).sort({ createdAt: -1 }).lean<any[]>(),
    Zone.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>(),
  ])
  const refUsers = await User.find({ _id: { $in: [...notes.map((n) => n.authorId), patient.consent?.by, ...labs.map((l) => l.by)].filter(Boolean) } })
    .select('name role')
    .lean<any[]>()
  const who = (uid: unknown) => refUsers.find((u) => String(u._id) === String(uid))
  const planServices = await ServiceType.find({ _id: { $in: plans.map((p) => p.serviceTypeId).filter(Boolean) } }).select('name').lean<any[]>()

  const masked = user.role === 'VIEWER'
  const canEdit = can(user, 'patients.edit')
  const canMessage = can(user, 'messages.send') && !masked
  const canCreate = can(user, 'requests.create')
  const ph = (p?: string) => (p ? (masked ? maskPhone(p) : fmtPhone(p)) : '—')

  const billOf = (v: any) => v.billing?.invoiceAmount ?? v.billing?.billAmount ?? v.billing?.estimatedFee ?? 0
  const due = visits.filter((v) => v.billing?.status === 'DUE').reduce((s, v) => s + billOf(v), 0)
  const outstanding = due + (patient.balance ?? 0)
  const paidVisits = visits.filter((v) => v.billing?.status === 'PAID')
  const lifetimePaid = paidVisits.reduce((s, v) => s + billOf(v), 0)
  const dueVisits = visits.filter((v) => v.billing?.status === 'DUE')

  const tab = sp.v === 'open' || sp.v === 'closed' ? sp.v : 'all'
  const openV = visits.filter((v) => ACTIVE_STATUSES.includes(v.status))
  const shownVisits = tab === 'open' ? openV : tab === 'closed' ? visits.filter((v) => !ACTIVE_STATUSES.includes(v.status)) : visits
  const history = [...(patient.addressHistory ?? [])].reverse()
  const since = patient.createdAt ? new Date(patient.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : null
  const current = openV[0]
  const waText = `Assalamu alaikum ${patient.name}, this is Unico Hospitals Home Care.${current ? ` About your visit ${current.requestNo}: ` : ' '}`

  return (
    <AdminPage title={patient.name} crumbs={<Link href="/patients">Patients</Link>}>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Avatar name={patient.name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] font-bold tracking-[-.01em]">{patient.name}</h2>
            {(patient.tags ?? []).map((t: string) => (
              <Tag key={t} tone="blue">
                {t}
              </Tag>
            ))}
          </div>
          <div className="text-[13px] text-slate-500">
            {[patient.ageYears != null ? `${patient.ageYears}` : null, GENDER[patient.gender], patient.uhid ? `UHID ${patient.uhid}` : null, patient.bloodGroup, since ? `patient since ${since}` : null, `${visits.length} visit${visits.length === 1 ? '' : 's'}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMessage && (
            <a href={telUrl(patient.phone)} className={btnClass('o')}>
              <Phone size={16} /> Call
            </a>
          )}
          {canMessage && patient.consent?.whatsapp !== false && <WhatsAppButton patientId={id} to="patient" text={waText} />}
          {canEdit && <PatientDrawerButton kind="o" zones={zones.map((z) => z.name)} patient={plain(patient)} />}
          {canCreate && (
            <LinkButton href={`/requests/new?patientId=${id}`}>
              <Plus size={16} /> New request for this patient
            </LinkButton>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
        {/* left column */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Contact & guardian" className="mb-2" />
            <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2.5 text-[13.5px]">
              <dt className="text-slate-500">Phone</dt>
              <dd>{ph(patient.phone)}</dd>
              <dt className="text-slate-500">Alt phone</dt>
              <dd>{ph(patient.altPhone)}</dd>
              <dt className="text-slate-500">Email</dt>
              <dd className="break-all">{masked ? (patient.email ? '•••' : '—') : (patient.email ?? '—')}</dd>
              <dt className="text-slate-500">Guardian</dt>
              <dd>
                {patient.guardian?.name ? (
                  <>
                    {patient.guardian.name}
                    {patient.guardian.relation ? ` · ${patient.guardian.relation.toLowerCase()}` : ''}
                    {patient.guardian.phone && <span className="block text-slate-500">{ph(patient.guardian.phone)}</span>}
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-slate-500">Consent</dt>
              <dd>
                WhatsApp {patient.consent?.whatsapp === false ? <span className="font-semibold text-[#B91C1C]">✗</span> : '✓'} · Email {patient.consent?.email === false ? <span className="font-semibold text-[#B91C1C]">✗</span> : '✓'}
                {patient.consent?.at && (
                  <span className="block text-[12px] text-slate-500">
                    {dateTime(patient.consent.at)}
                    {who(patient.consent.by) ? ` by ${who(patient.consent.by).name}` : ''}
                  </span>
                )}
              </dd>
              <dt className="text-slate-500">Allergies</dt>
              <dd className={cx((patient.allergies ?? []).length ? 'font-semibold text-[#B91C1C]' : 'text-slate-500')}>{(patient.allergies ?? []).join(' · ') || 'None recorded'}</dd>
              <dt className="text-slate-500">Conditions</dt>
              <dd>{(patient.conditions ?? []).join(' · ') || '—'}</dd>
              <dt className="text-slate-500">Landmark</dt>
              <dd>{patient.address?.landmark ?? '—'}</dd>
            </dl>
          </Card>

          <Card>
            <div className="text-[15px] font-bold">Balance</div>
            <div className={cx('mt-1 text-[30px] font-bold leading-tight', outstanding > 0 ? 'text-[#C2410C]' : 'text-[#15803D]')}>{taka(outstanding)}</div>
            <div className="text-[12.5px] text-slate-500">
              {outstanding > 0 ? `outstanding${dueVisits.length ? ` · ${dueVisits.map((v) => v.requestNo.slice(-4)).join(', ')}` : ''}` : 'nothing outstanding'}
            </div>
            <div className="mt-2 border-t border-slate-100 pt-2 text-[12.5px] text-slate-500">
              Lifetime paid {taka(lifetimePaid)} · {paidVisits.length} visit{paidVisits.length === 1 ? '' : 's'}
            </div>
          </Card>

          <Card>
            <CardHeader title="Address history" className="mb-3" />
            {history.length === 0 && patient.address?.full && (
              <div className="rounded-[10px] bg-primary-50 px-3 py-2.5">
                <div className="text-[13.5px] font-semibold">{patient.address.full}</div>
                <div className="text-[12px] text-slate-500">Current{patient.address.area ? ` · ${patient.address.area}` : ''}</div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {history.map((h: any, i: number) => (
                <div key={i} className={cx('rounded-[10px] px-3 py-2.5', !h.to ? 'bg-primary-50' : 'bg-slate-50')}>
                  <div className="text-[13.5px] font-semibold">{h.full}</div>
                  <div className="text-[12px] text-slate-500">
                    {!h.to ? `Current${h.from ? ` · since ${date(h.from)}` : ''}` : `${h.from ? `${date(h.from)} – ` : 'Until '}${date(h.to)}`}
                    {h.area ? ` · ${h.area}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title={`Care plans · ${plans.length}`} sub="Recurring visits ordered by a doctor" className="mb-3" />
            {plans.length === 0 ? (
              <div className="py-2 text-[13px] text-slate-400">No care plans</div>
            ) : (
              <div className="flex flex-col gap-2">
                {plans.map((p) => (
                  <div key={String(p._id)} className="rounded-[10px] border border-slate-200 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <CalendarClock size={15} className="text-primary" />
                      <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{p.title ?? 'Care plan'}</div>
                      <Tag tone={p.status === 'ACTIVE' ? 'green' : p.status === 'PAUSED' ? 'amber' : 'slate'}>{p.status}</Tag>
                    </div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      {[
                        planServices.find((s) => String(s._id) === String(p.serviceTypeId))?.name,
                        (p.daysOfWeek ?? []).map((d: number) => DAYS[d]).join(', '),
                        p.time ?? p.slot,
                        p.weeks ? `${p.weeks} weeks from ${dayNum(p.startDate)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="text-[12px] text-slate-500">
                      {p.orderedBy ? `Ordered by ${p.orderedBy} · ` : ''}
                      {(p.requestIds ?? []).length} visit{(p.requestIds ?? []).length === 1 ? '' : 's'} linked
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>


        {/* main column: visits, documents & notes, labs */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card pad={false} className="p-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 text-[15px] font-bold">Visits · {visits.length}</div>
              <Tabs
                className="border-b-0"
                active={tab}
                items={[
                  { key: 'all', label: 'All', href: `/patients/${id}` },
                  { key: 'open', label: 'Open', href: `/patients/${id}?v=open`, count: openV.length },
                  { key: 'closed', label: 'Closed', href: `/patients/${id}?v=closed` },
                ]}
              />
            </div>
            <Table cols={VCOLS} head={['Request', 'Service', 'When', 'Staff', 'Status', 'Times']} className="shadow-none ring-1 ring-slate-200" empty="No visits in this view">
              {shownVisits.map((v) => (
                <Tr key={String(v._id)} cols={VCOLS} href={`/requests/${v._id}`}>
                  <span className="font-mono text-[12.5px] font-semibold text-primary-700" title={v.requestNo}>
                    {v.requestNo}
                  </span>
                  <span className="block truncate" title={(v.services ?? []).map((s: any) => s.name).join(', ')}>
                    {(v.services ?? []).map((s: any) => s.name).join(', ') || '—'}
                  </span>
                  <span className="whitespace-nowrap">{v.scheduledAt ? `${dayNum(v.scheduledAt)} ${time(v.scheduledAt)}` : v.preferred?.date ? `${dayNum(v.preferred.date)} ${v.preferred.slot ?? ''}` : '—'}</span>
                  <span className="block truncate">{v.primaryStaff?.name ?? <span className="text-slate-400">Unassigned</span>}</span>
                  <StatusChip status={v.status} sm />
                  <span className="block truncate text-[12.5px] text-slate-600">{visitTimes(v)}</span>
                </Tr>
              ))}
            </Table>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title={`Documents · ${documents.length}`} className="mb-3" right={canEdit ? <UploadDocButton patientId={id} /> : undefined} />
            {documents.length === 0 ? (
              <div className="py-2 text-[13px] text-slate-400">No documents yet</div>
            ) : (
              <div className="flex flex-col">
                {documents.map((d) => (
                  <a key={String(d._id)} href={`/api/v1/attachments/${d._id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-md px-1 py-2 text-[13px] hover:bg-slate-50">
                    {d.mime?.startsWith('image/') ? <ImageIcon size={16} className="flex-none text-slate-400" /> : <FileText size={16} className="flex-none text-slate-400" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.caption || d.filename}</span>
                      <span className="block text-[11.5px] text-slate-500">
                        {d.kind?.replace('_', ' ').toLowerCase()}
                        {d.requestId ? ` · ${visits.find((v) => String(v._id) === String(d.requestId))?.requestNo ?? 'visit'}` : ''}
                      </span>
                    </span>
                    <span className="flex-none text-[12px] text-slate-500">{dayNum(d.at)}</span>
                  </a>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Notes" className="mb-3" />
            {patient.notes && <div className="mb-3 whitespace-pre-line rounded-[10px] bg-[#FEF3C7]/60 px-3 py-2.5 text-[13px] text-slate-700">{patient.notes}</div>}
            {notes.length === 0 && !patient.notes ? (
              <div className="py-2 text-[13px] text-slate-400">No notes yet</div>
            ) : (
              <div className="flex flex-col gap-3">
                {notes.map((n) => (
                  <div key={String(n._id)} className="text-[13px]">
                    <div className="whitespace-pre-line text-slate-700">{n.text}</div>
                    <div className="mt-0.5 text-[11.5px] text-slate-400">
                      {who(n.authorId)?.name ?? 'Staff'} · {ago(n.createdAt)}
                      {n.type !== 'GENERAL' ? ` · ${n.type.toLowerCase()}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </div>

          <Card>
            <CardHeader title={`Lab results · ${labs.length}`} className="mb-3" />
            {labs.length === 0 ? (
              <div className="py-2 text-[13px] text-slate-400">No lab results yet</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {labs.map((l) => (
                  <div key={String(l._id)} className="flex items-center gap-3 py-2.5 text-[13.5px]">
                    <FlaskConical size={16} className="flex-none text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{l.test}</div>
                      <div className="text-[12px] text-slate-500">
                        {l.status === 'PENDING' ? `Pending${l.eta ? ` · ETA ${dateTime(l.eta)}` : ''}` : `${l.summary ?? `${l.value ?? ''} ${l.unit ?? ''}`}${l.refRange ? ` · ref ${l.refRange}` : ''} · ${date(l.resultedAt ?? l.createdAt)}`}
                      </div>
                    </div>
                    {l.status === 'PENDING' ? (
                      <Tag tone="amber">Pending</Tag>
                    ) : (
                      <Tag tone={l.flag === 'NORMAL' ? 'green' : l.flag ? 'red' : 'slate'}>{l.flag ?? 'Resulted'}</Tag>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminPage>
  )
}
