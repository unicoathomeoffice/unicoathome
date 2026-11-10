import { route } from '@/lib/api'
import { User } from '@/lib/models'
import { H360Error } from '@/lib/h360'
import { background } from '@/lib/messaging'
import { directoryStale, searchDirectory, searchHisEmployees, syncHisDirectory, type HisEmployee } from '@/lib/h360-staff'

export const maxDuration = 30

/**
 * GET /api/v1/h360/staff?q= — hospital employees by name, designation, employee ID or phone, flagged when already in
 * HomeCare. Live HIS results first (name / ID / phone), then the local copy of the HIS list (finds designations too).
 */
export const GET = route(
  async ({ req }) => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return { items: [] }
    let live: HisEmployee[] = []
    let offline: { error: string; code: string } | null = null
    try {
      live = await searchHisEmployees(q)
    } catch (e) {
      if (!(e instanceof H360Error)) throw e
      offline = { error: e.message, code: e.code }
    }
    const local = await searchDirectory(q, 20)
    if (!offline && (await directoryStale())) background(() => syncHisDirectory()) // refresh the copy for next time
    const seen = new Set<string>()
    const items = [...live, ...local].filter((e) => !seen.has(e.employeeId) && !!seen.add(e.employeeId)).slice(0, 20)
    const known = items.length ? await User.find({ employeeId: { $in: items.map((e) => e.employeeId) }, deletedAt: null }).select('employeeId status external platformAccess').lean<any[]>() : []
    return {
      items: items.map((e) => {
        const u = known.find((k) => k.employeeId === e.employeeId)
        return { ...e, userId: u ? String(u._id) : null, inApp: !!u && !u.external, hasLogin: !!u && (u.platformAccess ?? []).includes('app'), active: u ? u.status === 'ACTIVE' : null }
      }),
      ...(offline && !items.length ? { offline: true, ...offline } : {}),
    }
  },
  { perm: 'requests.assign' },
)
