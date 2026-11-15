import { route, qp } from '@/lib/api'
import { loadPatientBoard, maskPhone } from '@/components/people/patient-board'

const PAGE = 25

/**
 * GET — the patient board (web /patients): each patient with their current request.
 * Filters: q (UHID, phone or name), zone, status (a status, ACTIVE or NONE), priority, staff (id or UNASSIGNED),
 * service; page (1-based, 25 per page). Phones are masked for read-only management, as on the web.
 */
export const GET = route(
  async ({ req, user }) => {
    const p = qp(req)
    const rows = await loadPatientBoard({
      q: p.get('q') ?? undefined,
      zone: p.get('zone') ?? undefined,
      status: p.get('status') ?? undefined,
      priority: p.get('priority') ?? undefined,
      staff: p.get('staff') ?? undefined,
      service: p.get('service') ?? undefined,
    })
    const page = Math.max(1, Number(p.get('page')) || 1)
    const mask = user.role === 'VIEWER' // same rule as the web board
    const items = rows.slice((page - 1) * PAGE, page * PAGE).map((r) => (mask ? { ...r, phone: maskPhone(r.phone) } : r))
    return { items, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / PAGE)) }
  },
  { perm: 'requests.readAll' },
)
