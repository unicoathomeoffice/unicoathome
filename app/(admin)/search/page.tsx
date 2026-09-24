import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Search, UserRound } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { can } from '@/lib/constants'
import { HomecareRequest, Patient } from '@/lib/models'
import { withPeople } from '@/lib/services/requests'
import { shortName } from '@/lib/services/dashboard'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Card, Empty, LinkButton, PriorityBadge, StatusChip, Table, Tr } from '@/components/ui'
import { ageGender, dayNum, phone as fmtPhone, relDay, time } from '@/lib/format'

export const metadata = { title: 'Search · Unico HomeCare' }

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const REQ_COLS = '170px minmax(200px,1.4fr) minmax(150px,1.2fr) 100px 140px 140px minmax(120px,1fr)'
const PAT_COLS = 'minmax(220px,1.5fr) 170px 120px minmax(140px,1fr) minmax(200px,1.2fr)'

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireWebUser()
  const q = ((await searchParams).q ?? '').trim()
  const readAll = can(user, 'requests.readAll')

  let requests: any[] = []
  let patients: any[] = []
  if (q) {
    const rx = escRe(q)
    const digits = q.replace(/\D/g, '')
    const short = /^#\s*\d{1,4}$/.test(q) ? `-${digits.padStart(4, '0')}$` : null
    const reqOr: any[] = [
      { requestNo: new RegExp(short ?? rx, 'i') },
      { 'patientSnapshot.name': new RegExp(rx, 'i') },
      { 'patientSnapshot.uhid': new RegExp(`^${rx}`, 'i') },
      ...(digits.length >= 4 ? [{ 'patientSnapshot.phone': new RegExp(digits.slice(-10)) }] : []),
    ]
    const reqFilter: Record<string, any> = { deletedAt: null, $or: reqOr }
    if (!readAll) reqFilter.$and = [{ $or: [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }, { createdBy: user.id }] }]

    // A request number that matches exactly one request goes straight to it
    if (/^(hc-?|#)/i.test(q) || /^\d{6}-\d{1,4}$/.test(q)) {
      const byNo = await HomecareRequest.find({ ...(reqFilter.$and ? { $and: reqFilter.$and } : {}), deletedAt: null, requestNo: new RegExp(short ?? rx, 'i') })
        .select('_id')
        .limit(2)
        .lean<any[]>()
      if (byNo.length === 1) redirect(`/requests/${byNo[0]._id}`)
    }

    ;[requests, patients] = await Promise.all([
      HomecareRequest.find(reqFilter).select('requestNo status priority patientId patientSnapshot services scheduledAt slot preferred assignment createdAt timeline').sort({ createdAt: -1 }).limit(50).lean<any[]>(),
      Patient.find({ deletedAt: null, $or: [{ name: new RegExp(rx, 'i') }, { uhid: new RegExp(`^${rx}`, 'i') }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])] })
        .sort({ updatedAt: -1 })
        .limit(30)
        .lean<any[]>(),
    ])
    await withPeople(requests)
    const counts = await HomecareRequest.aggregate([
      { $match: { patientId: { $in: patients.map((p) => p._id) }, deletedAt: null } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$patientId', n: { $sum: 1 }, last: { $first: '$createdAt' } } },
    ])
    for (const p of patients) {
      const c = counts.find((x) => String(x._id) === String(p._id))
      p.visits = c?.n ?? 0
      p.last = c?.last ?? null
    }
  }

  return (
    <AdminPage title="Search" crumbs={q ? <>Results for “{q}”</> : undefined}>
      <form action="/search" className="mb-6 flex max-w-2xl items-center gap-2 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 focus-within:border-primary">
        <Search size={18} className="text-slate-500" />
        <input name="q" defaultValue={q} autoFocus placeholder="Search phone, UHID, patient name or request no" className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400" />
        <button className="h-8 rounded-md bg-primary px-3 text-[13px] font-semibold text-white hover:bg-primary-700">Search</button>
      </form>

      {!q ? (
        <Card>
          <Empty icon={<Search size={24} />} title="Find a request or patient" sub="Type a phone number (last digits work), a UHID, a patient name or a request number such as HC-260924-0012 or #0012." />
        </Card>
      ) : !requests.length && !patients.length ? (
        <Card>
          <Empty
            icon={<Search size={24} />}
            title={`Nothing found for “${q}”`}
            sub="Check the spelling or try the phone number."
            action={can(user, 'requests.create') ? <LinkButton href="/requests/new">New request</LinkButton> : undefined}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-3 text-[15px] font-bold">
              Requests <span className="font-semibold text-slate-400">· {requests.length}{requests.length === 50 ? '+' : ''}</span>
            </h2>
            <Table cols={REQ_COLS} head={['Request', 'Patient', 'Service', 'Priority', 'Status', 'Schedule', 'Staff']} empty="No requests match">
              {requests.map((r) => (
                <Tr key={String(r._id)} cols={REQ_COLS} href={`/requests/${r._id}`}>
                  <span className="font-bold">{r.requestNo}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={r.patientSnapshot?.name} size={28} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">
                        {r.patientSnapshot?.name} <span className="font-normal text-slate-500">{ageGender(r.patientSnapshot?.ageYears, r.patientSnapshot?.gender)}</span>
                      </div>
                      <div className="truncate text-[12px] text-slate-500">
                        {fmtPhone(r.patientSnapshot?.phone)}
                        {r.patientSnapshot?.uhid ? ` · UHID ${r.patientSnapshot.uhid}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="block truncate">{(r.services ?? []).map((s: any) => s.name).join(', ')}</span>
                  <PriorityBadge priority={r.priority} />
                  <StatusChip status={r.status} sm />
                  <span className="block truncate">{r.scheduledAt ? `${relDay(r.scheduledAt)} ${r.slot && !r.preferred?.time ? r.slot : time(r.scheduledAt)}` : `Requested ${dayNum(r.createdAt)}`}</span>
                  <span className={r.primaryStaff ? 'block truncate' : 'text-slate-400'}>{r.primaryStaff ? shortName(r.primaryStaff.name) : 'Unassigned'}</span>
                </Tr>
              ))}
            </Table>
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-bold">
              Patients <span className="font-semibold text-slate-400">· {patients.length}{patients.length === 30 ? '+' : ''}</span>
            </h2>
            <Table cols={PAT_COLS} head={['Patient', 'Phone', 'UHID', 'Area', 'Visits']} empty="No patients match">
              {patients.map((p) => (
                <Tr key={String(p._id)} cols={PAT_COLS}>
                  <Link href={`/patients/${p._id}`} className="flex min-w-0 items-center gap-2 hover:text-primary-700">
                    <Avatar name={p.name} size={28} />
                    <div className="truncate font-semibold">
                      {p.name} <span className="font-normal text-slate-500">{ageGender(p.ageYears, p.gender)}</span>
                    </div>
                  </Link>
                  <span>{fmtPhone(p.phone)}</span>
                  <span className={p.uhid ? '' : 'text-slate-400'}>{p.uhid ?? '—'}</span>
                  <span className="block truncate">{p.address?.area ?? '—'}</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-500">
                      {p.visits} visit{p.visits === 1 ? '' : 's'}
                      {p.last ? ` · last ${dayNum(p.last)}` : ''}
                    </span>
                    {can(user, 'requests.create') && (
                        <Link href={`/requests/new?patientId=${p._id}`} className="inline-flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                          <UserRound size={13} /> New request
                        </Link>
                    )}
                  </div>
                </Tr>
              ))}
            </Table>
          </section>
        </div>
      )}
    </AdminPage>
  )
}
