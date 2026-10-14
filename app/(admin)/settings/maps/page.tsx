import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { canOpenSettings } from '@/lib/constants'
import { redirect } from 'next/navigation'
import { googleBudget, suggestedDailyCap, usageReport, KIND_LABEL } from '@/lib/maps-usage'
import { AdminPage } from '@/components/admin/AdminPage'
import { Bars, Card, CardHeader, Kpi, Tag } from '@/components/ui'
import { MapsSettings } from '@/components/admin-settings/MapsClient'

export const metadata = { title: 'Maps & API usage · Unico HomeCare' }

const REASON: Record<string, [string, 'green' | 'amber' | 'red' | 'slate']> = {
  ok: ['Google active', 'green'],
  off: ['Google switched off · OpenStreetMap', 'slate'],
  'no-key': ['No Google key · OpenStreetMap', 'slate'],
  'daily-cap': ['Daily cap reached · OpenStreetMap until tomorrow', 'amber'],
  'monthly-cap': ['Monthly allowance used · OpenStreetMap until next month', 'red'],
}

/** Google Maps cost control + call statistics (browsers report every map / geocoding call). */
export default async function MapsPage() {
  const user = await requireWebUser()
  if (!canOpenSettings(user)) redirect('/dashboard?denied=1')
  const s = await getSettings()
  const [budget, report] = await Promise.all([googleBudget(s.maps), usageReport(14)])
  const hasKey = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const [label, tone] = REASON[budget.reason] ?? REASON.ok
  const kinds = Object.entries(report.byKind).sort((a, b) => b[1].month - a[1].month)
  const monthCap = Math.floor(s.maps.monthlyFree * (1 - s.maps.reservePct / 100))

  return (
    <AdminPage title="Maps & API usage" crumbs="Settings">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Status" right={<Tag tone={tone}>{label}</Tag>} />
            <div className="grid grid-cols-2 gap-3">
              <Kpi dense label="Google today" n={`${budget.used.today} / ${budget.dailyCap}`} color={budget.remainingToday > 0 ? '#0072A3' : '#B45309'} sub={`${budget.remainingToday} left today`} />
              <Kpi dense label="Google this month" n={`${budget.used.month} / ${monthCap}`} color="#1F3864" sub={`${Math.max(0, monthCap - budget.used.month)} left`} />
            </div>
            <ul className="mt-3 space-y-1 text-[12.5px] text-slate-600">
              <li>• Phone GPS, OpenStreetMap maps and search are free and unlimited — they never count here.</li>
              <li>• Google key: {hasKey ? 'set' : 'not set'}. Google also needs active billing on the Google Cloud project.</li>
              <li>• Counts come from browsers reporting their own calls, so they are close but not exact.</li>
            </ul>
          </Card>
          <MapsSettings initial={JSON.parse(JSON.stringify(s.maps))} suggested={suggestedDailyCap(s.maps)} />
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Calls per day · last 14 days" sub="Google (dark) vs free OpenStreetMap + GPS (light)" />
            <Bars values={report.perDay.map((d) => d.google)} labels={report.perDay.map((d) => d.day.slice(5))} height={150} />
            <div className="mt-3 border-t border-slate-100 pt-3">
              <Bars values={report.perDay.map((d) => d.osm + d.device)} labels={report.perDay.map((d) => d.day.slice(5))} height={90} color="#3AB5A7" highlightLast={false} />
            </div>
          </Card>
          <Card>
            <CardHeader title="By call type" />
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[.05em] text-slate-500">
                  <th className="pb-2 font-semibold">Call</th>
                  <th className="pb-2 text-right font-semibold">Today</th>
                  <th className="pb-2 text-right font-semibold">This month</th>
                  <th className="pb-2 text-right font-semibold">14 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {kinds.map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2">{KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k}</td>
                    <td className="py-2 text-right tabular-nums">{v.today}</td>
                    <td className="py-2 text-right tabular-nums">{v.month}</td>
                    <td className="py-2 text-right tabular-nums">{v.total}</td>
                  </tr>
                ))}
                {!kinds.length && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No calls recorded yet — they appear as soon as someone opens the public booking page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </AdminPage>
  )
}
