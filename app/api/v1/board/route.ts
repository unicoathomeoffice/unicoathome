import { after } from 'next/server'
import { route, qp } from '@/lib/api'
import { boardRows, type BoardFilters } from '@/lib/services/dashboard'
import { sweep } from '@/lib/services/jobs'
import { User } from '@/lib/models'
import { activeServices, activeZones } from '@/lib/cached'
import { plain } from '@/lib/db'

/**
 * GET — the requests board (web /requests): pre-shaped rows plus the filter options.
 * Filters: status (comma list), priority, service, zone, staff, date (YYYY-MM-DD | today | tomorrow | week), q.
 * Like the web board it also runs the overdue / accept-timeout sweep in the background.
 */
export const GET = route(
  async ({ req }) => {
    const p = qp(req)
    const filters: BoardFilters = {
      status: p.get('status') ?? undefined,
      priority: p.get('priority') ?? undefined,
      service: p.get('service') ?? undefined,
      zone: p.get('zone') ?? undefined,
      staff: p.get('staff') ?? undefined,
      date: p.get('date') ?? undefined,
      q: p.get('q') ?? undefined,
    }
    after(async () => {
      try {
        await sweep()
      } catch (e) {
        console.error('sweep failed', e)
      }
    })
    const [rows, services, zones, staff] = await Promise.all([
      boardRows(filters),
      p.get('options') === '0' ? null : activeServices(),
      p.get('options') === '0' ? null : activeZones(),
      p.get('options') === '0' ? null : User.find({ role: { $in: ['DOCTOR', 'NURSE', 'ALLIED'] }, status: 'ACTIVE', deletedAt: null }).sort({ name: 1 }).select('name').lean<any[]>(),
    ])
    return plain({
      rows,
      options: services ? { services: services.map((s: any) => ({ code: s.code, name: s.name })), zones, staff: (staff ?? []).map((u) => ({ id: String(u._id), name: u.name })) } : null,
    })
  },
  { perm: 'requests.readAll' },
)
