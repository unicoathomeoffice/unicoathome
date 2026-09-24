import 'server-only'
import { Patient, HomecareRequest, User } from '@/lib/models'
import { ACTIVE_STATUSES, type Status } from '@/lib/constants'

export type BoardFilters = { q?: string; zone?: string; status?: string; priority?: string; staff?: string; service?: string }

export type BoardRow = {
  id: string
  name: string
  ageYears?: number
  gender?: string
  phone: string
  uhid?: string
  zone?: string
  visits: number
  active: boolean
  current: null | {
    requestId: string
    requestNo: string
    status: Status
    priority: string
    scheduledAt?: string
    slot?: string
    preferredDate?: string
    requestedAt?: string
    service?: string
    serviceCode?: string
    staffId?: string
    staffName?: string
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Patient board rows: each patient with its "current" request (the next active visit, else the latest one). */
export async function loadPatientBoard(fl: BoardFilters): Promise<BoardRow[]> {
  const f: Record<string, any> = { deletedAt: null }
  const q = fl.q?.trim()
  if (q) {
    const digits = q.replace(/\D/g, '')
    f.$or = [{ name: new RegExp(esc(q), 'i') }, { uhid: new RegExp(`^${esc(q)}`, 'i') }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits.slice(-10)) }, { altPhone: new RegExp(digits.slice(-10)) }] : [])]
  }
  if (fl.zone) f['address.area'] = fl.zone
  const patients = await Patient.find(f).select('name ageYears gender phone uhid address.area updatedAt').sort({ updatedAt: -1 }).limit(2000).lean<any[]>()
  const reqs = await HomecareRequest.find({ patientId: { $in: patients.map((p) => p._id) }, deletedAt: null })
    .select('patientId requestNo status priority scheduledAt slot preferred timeline.requestedAt createdAt services assignment.primaryStaffId')
    .sort({ createdAt: -1 })
    .lean<any[]>()
  const staffIds = [...new Set(reqs.map((r) => r.assignment?.primaryStaffId).filter(Boolean).map(String))]
  const staff = await User.find({ _id: { $in: staffIds } }).select('name').lean<any[]>()
  const staffName = (id: unknown) => staff.find((s) => String(s._id) === String(id))?.name

  const byPatient = new Map<string, any[]>()
  for (const r of reqs) {
    const k = String(r.patientId)
    if (!byPatient.has(k)) byPatient.set(k, [])
    byPatient.get(k)!.push(r)
  }
  const when = (r: any) => new Date(r.scheduledAt ?? r.timeline?.requestedAt ?? r.createdAt).getTime()

  let rows: BoardRow[] = patients.map((p) => {
    const list = byPatient.get(String(p._id)) ?? []
    const active = list.filter((r) => ACTIVE_STATUSES.includes(r.status)).sort((a, b) => when(a) - when(b))
    const cur = active[0] ?? list[0]
    return {
      id: String(p._id),
      name: p.name,
      ageYears: p.ageYears,
      gender: p.gender,
      phone: p.phone,
      uhid: p.uhid,
      zone: p.address?.area,
      visits: list.length,
      active: active.length > 0,
      current: cur
        ? {
            requestId: String(cur._id),
            requestNo: cur.requestNo,
            status: cur.status,
            priority: cur.priority,
            scheduledAt: cur.scheduledAt ? new Date(cur.scheduledAt).toISOString() : undefined,
            slot: cur.slot ?? cur.preferred?.slot,
            preferredDate: cur.preferred?.date,
            requestedAt: new Date(cur.timeline?.requestedAt ?? cur.createdAt).toISOString(),
            service: cur.services?.[0]?.name,
            serviceCode: cur.services?.[0]?.code,
            staffId: cur.assignment?.primaryStaffId ? String(cur.assignment.primaryStaffId) : undefined,
            staffName: staffName(cur.assignment?.primaryStaffId),
          }
        : null,
    }
  })

  if (fl.status) rows = rows.filter((r) => (fl.status === 'NONE' ? !r.current : fl.status === 'ACTIVE' ? r.active : r.current?.status === fl.status))
  if (fl.priority) rows = rows.filter((r) => r.current?.priority === fl.priority)
  if (fl.staff) rows = rows.filter((r) => (fl.staff === 'unassigned' ? r.current && !r.current.staffId : r.current?.staffId === fl.staff))
  if (fl.service) rows = rows.filter((r) => r.current?.serviceCode === fl.service)

  const prio = (p?: string) => (p === 'EMERGENCY' ? 0 : p === 'URGENT' ? 1 : 2)
  rows.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    if (a.active && b.active) {
      const ap = a.current?.status === 'NEW' ? prio(a.current?.priority) : 3
      const bp = b.current?.status === 'NEW' ? prio(b.current?.priority) : 3
      if (ap !== bp) return ap - bp
      return new Date(a.current?.scheduledAt ?? a.current?.requestedAt ?? 0).getTime() - new Date(b.current?.scheduledAt ?? b.current?.requestedAt ?? 0).getTime()
    }
    return new Date(b.current?.requestedAt ?? 0).getTime() - new Date(a.current?.requestedAt ?? 0).getTime()
  })
  return rows
}

/** "+880 1711-•••567" for read-only viewers */
export function maskPhone(p: string) {
  const d = p.replace(/\D/g, '')
  const local = d.startsWith('880') ? d.slice(3) : d.replace(/^0/, '')
  return local.length === 10 ? `+880 ${local.slice(0, 4)}-•••${local.slice(7)}` : '•••••'
}
