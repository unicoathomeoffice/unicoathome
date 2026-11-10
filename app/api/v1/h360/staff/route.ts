import { route } from '@/lib/api'
import { User } from '@/lib/models'
import { H360Error } from '@/lib/h360'
import { searchHisEmployees } from '@/lib/h360-staff'

export const maxDuration = 30

/** GET /api/v1/h360/staff?q= — hospital employees from the HIS roster search (name or ID), flagged when already in HomeCare. */
export const GET = route(
  async ({ req }) => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return { items: [] }
    try {
      const items = await searchHisEmployees(q)
      const known = items.length ? await User.find({ employeeId: { $in: items.map((e) => e.employeeId) }, deletedAt: null }).select('employeeId status external').lean<any[]>() : []
      return {
        items: items.map((e) => {
          const u = known.find((k) => k.employeeId === e.employeeId)
          return { ...e, userId: u ? String(u._id) : null, inApp: !!u && !u.external, active: u ? u.status === 'ACTIVE' : null }
        }),
      }
    } catch (e) {
      if (e instanceof H360Error) return { items: [], offline: true, error: e.message, code: e.code }
      throw e
    }
  },
  { perm: 'requests.assign' },
)
