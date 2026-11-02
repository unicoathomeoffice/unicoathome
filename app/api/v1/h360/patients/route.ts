import { route, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { Patient } from '@/lib/models'
import { H360Error, searchPatients } from '@/lib/h360'

export const maxDuration = 30

/** GET /api/v1/h360/patients?q= — live search in H360's Patient List (UHID, mobile or name), flagged when already in HomeCare. */
export const GET = route(async ({ req, user }) => {
  if (!can(user, 'requests.create') && !can(user, 'requests.readAll')) throw forbidden()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 3) return { items: [] }
  try {
    const items = await searchPatients(q)
    const uhids = items.map((p) => p.uhid).filter(Boolean)
    const phones = items.map((p) => p.phone?.replace(/\D/g, '').slice(-10)).filter((x): x is string => !!x && x.length === 10)
    const linked = uhids.length || phones.length ? await Patient.find({ deletedAt: null, $or: [{ uhid: { $in: uhids } }, ...phones.map((ph) => ({ phone: new RegExp(`${ph}$`) }))] }).select('uhid phone').lean<any[]>() : []
    return {
      items: items.map((p) => {
        const ph = p.phone?.replace(/\D/g, '').slice(-10)
        const hit = linked.find((x) => (p.uhid && x.uhid === p.uhid) || (ph && String(x.phone ?? '').replace(/\D/g, '').endsWith(ph)))
        return { ...p, linkedPatientId: hit ? String(hit._id) : null }
      }),
    }
  } catch (e) {
    if (e instanceof H360Error) return { items: [], offline: true, error: e.message, code: e.code }
    throw e
  }
})
