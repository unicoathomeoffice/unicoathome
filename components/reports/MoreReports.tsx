// Reports → Services · Consumables · Staff (server-rendered). Same date range and filters as the Overview tab.
import { CalendarDays, FileSpreadsheet, Package } from 'lucide-react'
import { Bars, Card, CardHeader, Empty, Kpi, Tag, btnClass } from '@/components/ui'
import { UrlDateRange, UrlSelect } from '@/components/comms/UrlFilters'
import { PrintButton } from '@/components/reports/PrintButton'
import { ROLE_LABEL, type Role } from '@/lib/constants'
import { consumablesReport, servicesReport, staffReport } from '@/lib/services/reports-more'
import { cx, date as fmtDate, taka } from '@/lib/format'

export type MoreView = 'services' | 'consumables' | 'staff'
type Filter = { from: string; to: string; service?: string; zone?: string }

const p = (v: number | null) => (v == null ? '—' : `${v}%`)
const m = (v: number | null) => (v == null ? '—' : `${v} min`)
const toneOf = (v: number | null, good = 90) => (v == null ? 'text-slate-400' : v >= good ? 'text-[#15803D]' : v >= good - 15 ? 'text-[#B45309]' : 'text-[#B91C1C]')
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00+06:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'Asia/Dhaka' })

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cx('px-3 pb-2 text-[11px] font-bold uppercase tracking-[.05em] text-slate-500', right ? 'text-right' : 'text-left')}>{children}</th>
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={cx('px-3 py-2', right && 'text-right tabular-nums', className)}>{children}</td>
}

export function ReportFilters({ view, f, services, zones }: { view: MoreView; f: Filter; services: { code: string; name: string }[]; zones: { name: string }[] }) {
  const qs = new URLSearchParams({ type: view, format: 'csv', from: f.from, to: f.to, ...(f.service ? { service: f.service } : {}), ...(f.zone ? { zone: f.zone } : {}) }).toString()
  return (
    <div className="no-print flex flex-wrap items-center gap-3">
      <UrlDateRange from={f.from} to={f.to} icon={<CalendarDays size={15} className="text-slate-500" />} />
      <UrlSelect param="service" label="Service" value={f.service ?? ''} options={[{ value: '', label: 'all' }, ...services.map((s) => ({ value: s.code, label: s.name }))]} />
      <UrlSelect param="zone" label="Zone" value={f.zone ?? ''} options={[{ value: '', label: 'all' }, ...zones.map((z) => ({ value: z.name, label: z.name }))]} />
      <div className="flex-1" />
      <a href={`/api/v1/reports?${qs}`} className={btnClass('o', 'md')} title="Opens in Excel">
        <FileSpreadsheet size={16} /> Excel
      </a>
      <PrintButton />
    </div>
  )
}

export async function MoreReports({ view, f }: { view: MoreView; f: Filter }) {
  const range = `${fmtDate(f.from)} – ${fmtDate(f.to)}`
  if (view === 'services') {
    const r = await servicesReport(f)
    const t = r.totals
    return (
      <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Requested" n={t.requested} sub={range} />
          <Kpi label="Completed" n={t.completed} color="#15803D" />
          <Kpi label="Cancelled" n={t.cancelled} color="#B91C1C" sub={t.cancelPct == null ? '' : `${t.cancelPct}% of requested`} />
          <Kpi label="Patients served" n={t.patients} />
          <Kpi label="Services" n={r.services.length} />
          <Kpi label="Amount (completed)" n={taka(t.amount)} color="#1F3864" sub="invoice, else bill amount" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="break-inside-avoid">
            <CardHeader title={`Home care services provided · ${range}`} />
            {r.services.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <Th>Service</Th>
                      <Th right>Requested</Th>
                      <Th right>Completed</Th>
                      <Th right>Cancelled</Th>
                      <Th right>Open</Th>
                      <Th right>Patients</Th>
                      <Th right>Avg visit</Th>
                      <Th right>Amount</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.services.map((s) => (
                      <tr key={s.name}>
                        <Td className="font-semibold">{s.name}</Td>
                        <Td right>{s.requested}</Td>
                        <Td right className="text-[#15803D]">{s.completed}</Td>
                        <Td right className={s.cancelled ? 'text-[#B91C1C]' : ''}>
                          {s.cancelled}
                          {s.cancelPct ? <span className="text-[11px] text-slate-400"> ({s.cancelPct}%)</span> : null}
                        </Td>
                        <Td right>{s.open}</Td>
                        <Td right>{s.patients}</Td>
                        <Td right>{m(s.avgDur)}</Td>
                        <Td right>{taka(s.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No requests in this range" />
            )}
          </Card>
          <Card className="break-inside-avoid">
            <CardHeader title="Per month" className="mb-3" />
            {r.months.length ? (
              <>
                <Bars values={r.months.map((x) => x.completed)} labels={r.months.map((x) => monthLabel(x.month))} height={130} />
                <table className="mt-3 w-full text-[12.5px]">
                  <thead>
                    <tr>
                      <Th>Month</Th>
                      <Th right>Requested</Th>
                      <Th right>Done</Th>
                      <Th right>Amount</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.months.map((x) => (
                      <tr key={x.month}>
                        <Td>{monthLabel(x.month)}</Td>
                        <Td right>{x.requested}</Td>
                        <Td right>{x.completed}</Td>
                        <Td right>{taka(x.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <Empty title="No data" />
            )}
          </Card>
        </div>
      </>
    )
  }

  if (view === 'consumables') {
    const r = await consumablesReport(f)
    const total = r.items.reduce((a, i) => a + i.qty, 0)
    const services = [...new Set(r.byService.map((x) => x.service))]
    return (
      <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Kpi label="Items used" n={total} sub={`${r.items.length} different item${r.items.length === 1 ? '' : 's'}`} />
          <Kpi label="Completed visits" n={r.completedVisits} sub={range} />
          <Kpi label="Usage recorded" n={p(r.recordedPct)} color="#0072A3" sub="completed visits with consumables" />
          <Kpi label="Bag fully packed" n={p(r.bagCompletePct)} color="#15803D" sub={`${r.bagJourneys} journey${r.bagJourneys === 1 ? '' : 's'} with a bag check`} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="break-inside-avoid">
            <CardHeader title={`Consumables used · ${range}`} />
            {r.items.length ? (
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th right>Quantity</Th>
                    <Th right>Visits</Th>
                    <Th right>Per visit</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.items.map((i) => (
                    <tr key={i.id}>
                      <Td>
                        <span className="flex items-center gap-2.5">
                          <span className="flex size-9 flex-none items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
                            {i.imageId && i.catalogId ? <img src={`/api/v1/equipment/${i.catalogId}/image?v=${i.imageId}`} alt="" className="size-full object-cover" /> : <Package size={16} />}
                          </span>
                          <span className="font-semibold">{i.name}</span>
                          {!i.catalogId && <Tag tone="slate">free text</Tag>}
                        </span>
                      </Td>
                      <Td right className="font-bold">
                        {i.qty} <span className="text-[11px] font-normal text-slate-500">{i.unit}</span>
                      </Td>
                      <Td right>{i.visits}</Td>
                      <Td right>{i.perVisit ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No consumables recorded in this range" sub="Staff record them on the app: Visit → Consumables used." />
            )}
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="break-inside-avoid">
              <CardHeader title="By staff · top 15" className="mb-2" />
              {r.byStaff.length ? (
                <table className="w-full text-[12.5px]">
                  <tbody className="divide-y divide-slate-100">
                    {r.byStaff.map((s) => (
                      <tr key={s.name}>
                        <Td>{s.name}</Td>
                        <Td right>
                          {s.qty} items · {s.visits} visit{s.visits === 1 ? '' : 's'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="No data" />
              )}
            </Card>
            <Card className="break-inside-avoid">
              <CardHeader title="By service" className="mb-2" />
              {services.length ? (
                services.map((svc) => (
                  <div key={svc} className="mb-2.5 last:mb-0">
                    <div className="text-[12.5px] font-bold text-slate-700">{svc}</div>
                    <div className="text-[12.5px] text-slate-600">
                      {r.byService
                        .filter((x) => x.service === svc)
                        .slice(0, 6)
                        .map((x) => `${x.item} × ${x.qty}`)
                        .join(' · ')}
                    </div>
                  </div>
                ))
              ) : (
                <Empty title="No data" />
              )}
            </Card>
          </div>
        </div>
      </>
    )
  }

  const r = await staffReport(f)
  return (
    <Card className="break-inside-avoid">
      <CardHeader title={`Staff productivity · ${range}`} right={<span className="text-[12px] text-slate-500">Each team member counts every visit they were on</span>} />
      {r.staff.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr>
                <Th>Staff</Th>
                <Th right>Visits</Th>
                <Th right>Done</Th>
                <Th right>Cancelled</Th>
                <Th right>On time</Th>
                <Th right>Avg visit</Th>
                <Th right>Travel out</Th>
                <Th right>Travel back</Th>
                <Th right>After-return done</Th>
                <Th right>Consumables recorded</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.staff.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="font-semibold">
                      {s.name} {s.external && <Tag tone="violet">Outside</Tag>}
                    </div>
                    <div className="text-[11.5px] text-slate-500">{[ROLE_LABEL[s.role as Role] ?? s.role, s.employeeId].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td right>{s.visits}</Td>
                  <Td right className="text-[#15803D]">{s.completed}</Td>
                  <Td right>{s.cancelled}</Td>
                  <Td right className={cx('font-semibold', toneOf(s.onTimePct))}>{p(s.onTimePct)}</Td>
                  <Td right>{m(s.avgDur)}</Td>
                  <Td right>{m(s.avgOut)}</Td>
                  <Td right>{m(s.avgBack)}</Td>
                  <Td right className={toneOf(s.afterPct, 95)}>{p(s.afterPct)}</Td>
                  <Td right className={toneOf(s.consPct, 80)}>{p(s.consPct)}</Td>
                  <Td right>{taka(s.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No visits in this range" />
      )}
    </Card>
  )
}
