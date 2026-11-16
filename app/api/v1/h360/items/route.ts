import { route, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { H360Error } from '@/lib/h360'
import { searchH360Items } from '@/lib/h360-items'
import { h360BillingOf } from '@/lib/h360-patient'

export const maxDuration = 30

/** GET /api/v1/h360/items?q=&type=&uhid= — search H360's tests / procedures / services with prices (read-only). With a
 *  registered patient's UHID each item also carries the discount H360 gives that patient's corporate (discountPct). */
export const GET = route(async ({ req, user }) => {
  if (!can(user, 'requests.create') && !can(user, 'requests.readAll') && !can(user, 'requests.manage')) throw forbidden()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return { items: [] }
  try {
    const uhid = (req.nextUrl.searchParams.get('uhid') ?? '').trim()
    const reg = /^[\w-]{3,30}$/.test(uhid) ? await h360BillingOf(uhid).catch(() => null) : null
    const items = await searchH360Items(q, { patientType: req.nextUrl.searchParams.get('type') ?? undefined, corporateId: reg?.corporateId })
    return { items, corporate: reg?.corporate ?? null, registered: !!reg }
  } catch (e) {
    if (e instanceof H360Error) return { items: [], offline: true, error: e.message, code: e.code }
    throw e
  }
})
