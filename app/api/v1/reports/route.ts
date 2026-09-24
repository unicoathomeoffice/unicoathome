import { route, qp, clientMeta, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { getReport, requestsCsv, messagesCsv, normaliseFilter } from '@/lib/services/reports'
import { audit } from '@/lib/audit'

/**
 * GET /api/v1/reports?from=YYYY-MM-DD&to=&groupBy=day|staff|service|zone&service=&zone=   → JSON report (W14)
 * GET /api/v1/reports?type=requests&format=csv&from&to[&service&zone]                      → one row per request
 * GET /api/v1/reports?type=messages&format=csv[&channel&status&q&from&to]                  → message log
 */
export const GET = route(
  async ({ req, user }) => {
    const p = qp(req)
    const isMessages = p.get('type') === 'messages'
    // message export follows the Messages page access (front desk included); everything else needs reports.view
    if (isMessages ? !['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER'].includes(user.role) : !can(user, 'reports.view')) throw forbidden()
    const filter = normaliseFilter({ from: p.get('from'), to: p.get('to'), groupBy: p.get('groupBy'), service: p.get('service'), zone: p.get('zone') })
    if (p.get('format') === 'csv') {
      const type = p.get('type') ?? 'requests'
      const out =
        isMessages
          ? await messagesCsv({ channel: p.get('channel'), status: p.get('status'), q: p.get('q'), from: p.get('from'), to: p.get('to') })
          : await requestsCsv(filter)
      await audit(user, 'report.export', 'report', type, { after: { type, format: 'csv', from: p.get('from') ?? filter.from, to: p.get('to') ?? filter.to, rows: out.count }, label: out.filename }, clientMeta(req, user))
      return new Response(out.csv, {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.filename}"`, 'cache-control': 'no-store' },
      })
    }
    return { report: await getReport(filter) }
  },
  {},
)
