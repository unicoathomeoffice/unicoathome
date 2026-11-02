import { route, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { H360Error } from '@/lib/h360'
import { searchH360Items } from '@/lib/h360-items'

export const maxDuration = 30

/** GET /api/v1/h360/items?q=&type= — search H360's tests / procedures / services with prices (read-only). */
export const GET = route(async ({ req, user }) => {
  if (!can(user, 'requests.create') && !can(user, 'requests.readAll') && !can(user, 'requests.manage')) throw forbidden()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return { items: [] }
  try {
    return { items: await searchH360Items(q, { patientType: req.nextUrl.searchParams.get('type') ?? undefined }) }
  } catch (e) {
    if (e instanceof H360Error) return { items: [], offline: true, error: e.message, code: e.code }
    throw e
  }
})
