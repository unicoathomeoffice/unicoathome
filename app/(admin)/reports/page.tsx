import type { Metadata } from 'next'
import { CalendarDays, Download, FileSpreadsheet, Star } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { ServiceType, Zone } from '@/lib/models'
import { getReport, normaliseFilter, type ReportRow } from '@/lib/services/reports'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Bars, Card, CardHeader, HBars, Kpi, Label, StatusChip, Table, Tr, Empty, btnClass } from '@/components/ui'
import { UrlDateRange, UrlSelect } from '@/components/comms/UrlFilters'
import { PrintButton, PrintStyles } from '@/components/reports/PrintButton'
import { cx, date as fmtDate, dayNum, dur, taka } from '@/lib/format'

export const metadata: Metadata = { title: 'Reports' }

type SP = Promise<Record<string, string | undefined>>

const pctText = (v: number | null) => (v == null ? '—' : `${v}%`)
const tone = (v: number | null, target = 90) => (v == null ? '#0F172A' : v >= target ? '#15803D' : v >= target - 10 ? '#B45309' : '#B91C1C')
const barColor = (v: number | null) => (v == null ? '#CBD5E1' : v >= 90 ? '#16A34A' : v >= 80 ? '#0090CA' : '#F59E0B')

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  await requireWebUser('reports.view')
  const sp = await searchParams
  const f = normaliseFilter(sp)
  const [r, services, zones] = await Promise.all([
    getReport(f),
    ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name').lean<any[]>(),
    Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>(),
  ])
  const t = r.totals
  const sla = r.sla
  const qs = new URLSearchParams({ type: 'requests', format: 'csv', from: f.from, to: f.to, ...(f.service ? { service: f.service } : {}), ...(f.zone ? { zone: f.zone } : {}) }).toString()
  const csvUrl = `/api/v1/reports?${qs}`
  const rangeText = `${fmtDate(f.from)} – ${fmtDate(f.to)}`
  const groupLabel = { day: 'Day', staff: 'Staff', service: 'Service', zone: 'Zone' }[f.groupBy]
  const vol = r.volume.length > 45 ? weekly(r.volume) : r.volume.map((v) => ({ label: dayNum(v.day).split(' ')[0], n: v.n, title: v.day }))

  return (
    <AdminPage title="Reports">
      <PrintStyles />
      <div data-print-root className="flex flex-col gap-4">
        {/* print-only heading */}
        <div className="hidden print:block">
          <img src="/logo.svg" alt="Unico Hospitals" className="mb-2 h-9" />
          <div className="text-lg font-bold">Home care report · {rangeText}</div>
          <div className="text-[12px] text-slate-500">
            {f.service ? `Service ${services.find((s) => s.code === f.service)?.name ?? f.service} · ` : ''}
            {f.zone ? `Zone ${f.zone} · ` : ''}Generated {fmtDate(new Date())} · Unico HomeCare
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-3">
          <UrlDateRange from={f.from} to={f.to} icon={<CalendarDays size={15} className="text-slate-500" />} />
          <UrlSelect
            param="groupBy"
            label="Group by"
            value={f.groupBy}
            options={[
              { value: 'day', label: 'day' },
              { value: 'staff', label: 'staff' },
              { value: 'service', label: 'service' },
              { value: 'zone', label: 'zone' },
            ]}
          />
          <UrlSelect param="service" label="Service" value={f.service ?? ''} options={[{ value: '', label: 'all' }, ...services.map((s) => ({ value: s.code, label: s.name }))]} />
          <UrlSelect param="zone" label="Zone" value={f.zone ?? ''} options={[{ value: '', label: 'all' }, ...zones.map((z) => ({ value: z.name, label: z.name }))]} />
          <div className="flex-1" />
          <a href={csvUrl} className={btnClass('o', 'md')} title="One row per request">
            <Download size={16} /> CSV
          </a>
          <a href={csvUrl} className={btnClass('o', 'md')} title="CSV (opens in Excel)">
            <FileSpreadsheet size={16} /> Excel
          </a>
          <PrintButton />
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Requests" n={t.n} sub={r.changePct == null ? `${r.days} days` : `${r.changePct >= 0 ? '+' : ''}${r.changePct}% vs previous ${r.days} d`} />
          <Kpi label="Completed" n={t.completed} color="#15803D" sub={t.completionPct == null ? '—' : `${t.completionPct}% of non-cancelled`} />
          <Kpi label="Avg response" n={t.avgResp == null ? '—' : dur(t.avgResp)} sub={`target ${sla.confirmRoutineMin}`} color={t.avgResp != null && t.avgResp > sla.confirmRoutineMin ? '#B45309' : '#0F172A'} />
          <Kpi label="Avg assignment" n={t.avgAssign == null ? '—' : dur(t.avgAssign)} sub={`target ${sla.assignMin}`} color={t.avgAssign != null && t.avgAssign > sla.assignMin ? '#B45309' : '#0F172A'} />
          <Kpi label="On-time arrival" n={pctText(t.onTimePct)} color={tone(t.onTimePct)} sub={`target 90 · ≤ +${sla.lateAfterMin} min`} />
          <Kpi label="Declines" n={r.declines + r.timeouts} color="#B45309" sub={`${r.timeouts} timeout${r.timeouts === 1 ? '' : 's'}${r.declineReasons[0] && r.declineReasons[0].reason !== 'Timeout' ? ` · ${r.declineReasons[0].n} “${r.declineReasons[0].reason.toLowerCase()}”` : ''}`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_394px]">
          <Card className="break-inside-avoid">
            <CardHeader title={`Staff report · ${rangeText}`} right={<span className="text-[12px] text-slate-500">Ratings from patient feedback link</span>} />
            <StaffTable rows={r.staff} />
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="break-inside-avoid">
              <CardHeader title={r.volume.length > 45 ? 'Requests per week' : 'Requests per day'} right={<span className="text-[12px] text-slate-500">{t.n} total</span>} className="mb-3" />
              {t.n ? <Bars values={vol.map((v) => v.n)} labels={vol.map((v) => v.label)} height={120} /> : <Empty title="No requests in this range" />}
            </Card>
            <Card className="break-inside-avoid">
              <CardHeader title="SLA attainment" className="mb-3" />
              <div className="flex flex-col gap-3">
                <SlaBar label={`Response ≤ ${sla.confirmRoutineMin} min`} v={t.respPct} note={`urgent ≤ ${sla.confirmUrgentMin}`} />
                <SlaBar label={`Assignment ≤ ${sla.assignMin} min`} v={t.assignPct} />
                <SlaBar label={`Acceptance ≤ ${sla.acceptTimeoutMin} min`} v={t.acceptPct} />
                <SlaBar label={`Check-in ≤ +${sla.lateAfterMin} min`} v={t.onTimePct} />
                <SlaBar label="Report same day" v={t.sameDayPct} />
              </div>
            </Card>
          </div>
        </div>

        <Card className="break-inside-avoid">
          <CardHeader title="Timing metrics" sub="Averages over the range (plan §4.3). Only requests that reached both timestamps count." />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Metric label="Response" v={t.avgResp} target={`≤ ${sla.confirmRoutineMin} min`} bad={t.avgResp != null && t.avgResp > sla.confirmRoutineMin} sub="confirmed − requested" />
            <Metric label="Assignment" v={t.avgAssign} target={`≤ ${sla.assignMin} min`} bad={t.avgAssign != null && t.avgAssign > sla.assignMin} sub="assigned − confirmed" />
            <Metric label="Acceptance" v={t.avgAccept} target={`≤ ${sla.acceptTimeoutMin} min`} bad={t.avgAccept != null && t.avgAccept > sla.acceptTimeoutMin} sub="accepted − assigned" />
            <Metric label="Punctuality" v={t.avgLate} signed target={`≤ +${sla.lateAfterMin} min`} bad={t.avgLate != null && t.avgLate > sla.lateAfterMin} sub="check-in − scheduled" />
            <Metric label="Visit duration" v={t.avgDur} target={`overtime ${t.overtime}`} sub="check-out − check-in" />
            <Metric label="Turnaround" v={t.avgTurn} target="routine ≤ 48 h" bad={t.avgTurn != null && t.avgTurn > 48 * 60} sub="completed − requested" />
            <Metric label="Report lag" v={t.avgLag} target="same day" bad={t.avgLag != null && t.avgLag > 24 * 60} sub="closed − completed" />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="break-inside-avoid">
            <CardHeader title="Service mix" sub="Requests per service type" />
            <HBars items={r.services.slice(0, 10).map((s) => [s.name, s.n])} labelWidth={140} />
          </Card>
          <Card className="break-inside-avoid">
            <CardHeader title="Zone mix" sub="Requests per patient area" />
            <HBars items={r.zones.slice(0, 10).map((z) => [z.name, z.n])} color="#3AB5A7" labelWidth={110} />
          </Card>
          <Card className="break-inside-avoid">
            <CardHeader title="Transport mode" sub="Completed visits · “service provided by”" />
            <HBars items={r.transport.map((x) => [x.label, x.n])} color="#1F3864" labelWidth={130} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="break-inside-avoid">
            <CardHeader title="Revenue" sub="Bill amounts recorded at check-out (Google Form billing fields)" />
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Billed" v={taka(r.revenue.billed)} />
              <MiniStat label="Paid" v={taka(r.revenue.paid)} color="#15803D" />
              <MiniStat label="Due" v={taka(r.revenue.due)} color={r.revenue.due ? '#B45309' : undefined} />
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <Label className="mb-2">By payment method</Label>
                {r.revenue.methods.length ? (
                  <div className="flex flex-col">
                    {r.revenue.methods.map((m) => (
                      <div key={m.method} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
                        <span className="text-slate-700">
                          {m.label} <span className="text-slate-400">· {m.n}</span>
                        </span>
                        <span className="font-bold">{taka(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-3 text-[13px] text-slate-400">No bills recorded</div>
                )}
              </div>
              <div>
                <Label className="mb-2">Invoices (completed visits)</Label>
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">Invoice printed</span>
                  <span className="font-bold text-[#15803D]">{r.revenue.invoicePrinted}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 py-2 text-sm">
                  <span className="text-slate-700">Not printed yet</span>
                  <span className={cx('font-bold', r.revenue.invoiceNotPrinted ? 'text-[#B45309]' : '')}>{r.revenue.invoiceNotPrinted}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 py-2 text-sm">
                  <span className="text-slate-700">No bill amount</span>
                  <span className="font-bold">{r.revenue.unbilled}</span>
                </div>
              </div>
            </div>
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="break-inside-avoid">
              <CardHeader title="Petty cash" sub="Requested by staff during visits" />
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Approved" v={taka(r.petty.approved.amount)} sub={`${r.petty.approved.n} request${r.petty.approved.n === 1 ? '' : 's'}`} color="#15803D" />
                <MiniStat label="Pending" v={taka(r.petty.pending.amount)} sub={`${r.petty.pending.n}`} color={r.petty.pending.n ? '#B45309' : undefined} />
                <MiniStat label="Rejected" v={taka(r.petty.rejected.amount)} sub={`${r.petty.rejected.n}`} />
              </div>
            </Card>
            <Card className="break-inside-avoid">
              <CardHeader title="Declines & timeouts" sub={`${r.declines} declined · ${r.timeouts} timed out`} />
              <HBars items={r.declineReasons.map((d) => [d.reason, d.n])} color="#F59E0B" labelWidth={110} />
            </Card>
          </div>
        </div>

        <Card className="break-inside-avoid">
          <CardHeader title="Status mix" sub="Where the requests in this range are now" />
          {r.statuses.length ? (
            <div className="flex flex-wrap gap-2.5">
              {r.statuses.map((s) => (
                <div key={s.status} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
                  <StatusChip status={s.status} sm />
                  <span className="text-sm font-bold">{s.n}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-slate-400">No requests</div>
          )}
        </Card>

        <Breakdown title={`By ${groupLabel.toLowerCase()}`} head={groupLabel} rows={r.breakdown} fmtKey={f.groupBy === 'day' ? (k) => fmtDate(k) : undefined} />
      </div>
    </AdminPage>
  )
}

function weekly(v: { day: string; n: number }[]) {
  const out: { label: string; n: number; title: string }[] = []
  for (let i = 0; i < v.length; i += 7) {
    const chunk = v.slice(i, i + 7)
    out.push({ label: dayNum(chunk[0].day), n: chunk.reduce((a, c) => a + c.n, 0), title: chunk[0].day })
  }
  return out
}

function SlaBar({ label, v, note }: { label: string; v: number | null; note?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span className="text-slate-700">
          {label}
          {note && <span className="ml-1.5 text-[11.5px] text-slate-400">{note}</span>}
        </span>
        <span className="font-bold">{pctText(v)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${v ?? 0}%`, background: barColor(v) }} />
      </div>
    </div>
  )
}

function Metric({ label, v, target, sub, bad, signed }: { label: string; v: number | null; target: string; sub: string; bad?: boolean; signed?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-500">{label}</div>
      <div className={cx('mt-0.5 text-[22px] font-bold', bad ? 'text-[#B45309]' : 'text-slate-900')}>{v == null ? '—' : `${signed && v > 0 ? '+' : signed && v < 0 ? '−' : ''}${dur(v)}`}</div>
      <div className="text-[11.5px] text-slate-500">{target}</div>
      <div className="mt-1 text-[11px] text-slate-400">{sub}</div>
    </div>
  )
}

function MiniStat({ label, v, sub, color }: { label: string; v: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold" style={{ color }}>
        {v}
      </div>
      {sub && <div className="text-[11.5px] text-slate-500">{sub}</div>}
    </div>
  )
}

const STAFF_COLS = 'minmax(160px,2.2fr) 52px 70px 84px 72px 62px 84px'
function StaffTable({ rows }: { rows: (ReportRow & { id: string; name: string; designation?: string })[] }) {
  return (
    <Table cols={STAFF_COLS} head={['Staff', 'Visits', 'On time', 'Avg dur.', 'Declines', 'Rating', 'Overtime']} className="shadow-none ring-1 ring-slate-200" empty="No staff activity in this range">
      {rows.map((s) => (
        <Tr key={s.id} cols={STAFF_COLS}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={s.name} size={28} />
            <div className="min-w-0 truncate">
              <span className="font-semibold">{s.name}</span>
              {s.designation && <span className="text-slate-500"> · {s.designation}</span>}
            </div>
          </div>
          <span className="font-semibold">{s.completed}</span>
          <span className="font-bold" style={{ color: tone(s.onTimePct) }}>
            {pctText(s.onTimePct)}
          </span>
          <span>{s.avgDur == null ? '—' : dur(s.avgDur)}</span>
          <span className={cx(s.declines ? 'font-semibold text-[#B45309]' : '')}>{s.declines}</span>
          <span className="inline-flex items-center gap-1">
            {s.rating == null ? (
              <span className="text-slate-400">—</span>
            ) : (
              <>
                <Star size={13} className="fill-[#F59E0B] text-[#F59E0B]" /> {s.rating.toFixed(1)}
              </>
            )}
          </span>
          <span>{s.overtime}</span>
        </Tr>
      ))}
    </Table>
  )
}

const BD_COLS = 'minmax(180px,2fr) 90px 100px 90px 110px 110px 80px 110px'
function Breakdown({ title, head, rows, fmtKey }: { title: string; head: string; rows: (ReportRow & { key: string; label: string })[]; fmtKey?: (k: string) => string }) {
  return (
    <div className="break-inside-avoid">
      <div className="mb-2 mt-2 text-[15px] font-bold">{title}</div>
      <Table cols={BD_COLS} head={[head, 'Requests', 'Completed', 'On time', 'Avg response', 'Avg duration', 'Declines', 'Billed']} empty="No requests in this range">
        {rows.map((b) => (
          <Tr key={b.key} cols={BD_COLS}>
            <span className="truncate font-semibold">{fmtKey ? fmtKey(b.key) : b.label}</span>
            <span>{b.n}</span>
            <span>
              {b.completed} <span className="text-slate-400">{b.completionPct != null ? `· ${b.completionPct}%` : ''}</span>
            </span>
            <span className="font-semibold" style={{ color: tone(b.onTimePct) }}>
              {pctText(b.onTimePct)}
            </span>
            <span>{b.avgResp == null ? '—' : dur(b.avgResp)}</span>
            <span>{b.avgDur == null ? '—' : dur(b.avgDur)}</span>
            <span>{b.declines}</span>
            <span className="font-semibold">{taka(b.billed)}</span>
          </Tr>
        ))}
      </Table>
    </div>
  )
}
