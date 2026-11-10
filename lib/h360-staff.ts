import 'server-only'
import { getH360Config, H360Error } from './h360'
import { readOnlyPost } from './h360-items'
import { memo } from './memo'
import { HisEmployee as HisEmployeeModel } from './models'
import type { Role } from './constants'

// Outside staff: hospital employees who are not registered in this app, found with the HIS Roster page's
// "Employee Search" (the same search, read-only). Only work details are taken — name, ID, designation, unit, phone.

export type HisEmployee = { employeeId: string; name: string; designation?: string; department?: string; gender?: string; phone?: string }

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const last10 = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-10)

const toEmployee = (r: any): HisEmployee => ({
  employeeId: clean(String(r.person_code)),
  name: clean(r.full_name),
  designation: clean(r.designation) || undefined,
  department: clean(r.su_name) || undefined,
  gender: clean(r.gender_txt) || undefined,
  phone: clean(r.phone_mobile) || undefined,
})

/** The HIS Employee Search (read-only). It matches name, employee ID and phone — not designation. */
async function hisSearch(term: string): Promise<HisEmployee[]> {
  const res = await readOnlyPost('/doctor-info-autocomplete', { search_data: term, personnel_ind_name: 'employee_ind', personnel_ind: '1' })
  if (!res.ok) throw new H360Error('DOWN', `H360 employee search answered ${res.status}`)
  const json: any = await res.json().catch(() => null)
  const rows: any[] = Array.isArray(json) ? json : (json?.data ?? [])
  return rows.filter((r) => r?.person_code && r?.full_name).map(toEmployee)
}

/** Keep the local directory current with whatever the HIS returned. */
async function remember(list: HisEmployee[]) {
  if (!list.length) return
  const now = new Date()
  await HisEmployeeModel.bulkWrite(
    list.map((e) => ({
      updateOne: {
        filter: { _id: e.employeeId },
        update: { $set: { name: e.name, designation: e.designation, department: e.department, gender: e.gender, phone: e.phone, phoneDigits: last10(e.phone), syncedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false },
  ).catch((err) => console.error('[his directory]', err?.message ?? err))
}

/** Search HIS employees by name, employee ID or phone (min 2 characters). Max 15, cached 60 s per term. */
export async function searchHisEmployees(q: string): Promise<HisEmployee[]> {
  const term = q.trim()
  if (term.length < 2) return []
  if (!(await getH360Config())) throw new H360Error('NOT_CONFIGURED', 'H360 is not connected')
  return memo(`h360s:${term.toLowerCase()}`, 60_000, async () => {
    const all = await hisSearch(term)
    void remember(all.slice(0, 200))
    return all.slice(0, 15)
  })
}

/**
 * Daily read-only copy of the whole HIS employee list (single-letter / digit searches return everyone whose name, ID
 * or phone holds that character — a dozen calls cover the hospital). Lets us search by designation as well.
 */
export async function syncHisDirectory(): Promise<{ count: number }> {
  if (!(await getH360Config())) return { count: 0 }
  const seen = new Map<string, HisEmployee>()
  for (const t of ['a', 'e', 'i', 'o', 'u', 'y', 'n', 'r', 'h', '0', '1', '2', '3', '5', '7', '9']) {
    for (const e of await hisSearch(t).catch(() => [] as HisEmployee[])) seen.set(e.employeeId, e)
  }
  await remember([...seen.values()])
  return { count: seen.size }
}

/** Is the directory older than a day (or empty)? */
export async function directoryStale() {
  const newest = await HisEmployeeModel.findOne().sort({ syncedAt: -1 }).select('syncedAt').lean<any>()
  return !newest?.syncedAt || Date.now() - new Date(newest.syncedAt).getTime() > 24 * 3600_000
}

/** Local directory search: every word must match the name, designation, department, ID or phone. */
export async function searchDirectory(q: string, limit = 20): Promise<HisEmployee[]> {
  const words = q.trim().split(/\s+/).filter((w) => w.length >= 2).slice(0, 4)
  if (!words.length) return []
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const and = words.map((w) => {
    const rx = new RegExp(esc(w), 'i')
    const digits = w.replace(/\D/g, '')
    return { $or: [{ name: rx }, { designation: rx }, { department: rx }, { _id: rx }, ...(digits.length >= 3 ? [{ phoneDigits: new RegExp(digits) }] : [])] }
  })
  const rows = await HisEmployeeModel.find({ $and: and }).sort({ name: 1 }).limit(limit).lean<any[]>()
  return rows.map((r) => ({ employeeId: String(r._id), name: r.name, designation: r.designation, department: r.department, gender: r.gender, phone: r.phone }))
}

/** One employee by exact HIS employee ID (re-read from the HIS, never trusted from the browser). */
export async function hisEmployee(employeeId: string): Promise<HisEmployee | null> {
  const id = employeeId.trim()
  return (await searchHisEmployees(id)).find((e) => e.employeeId === id) ?? null
}

/** Field role from the HIS designation: doctors / medical officers → DOCTOR, nurses → NURSE, everyone else → ALLIED. */
export function roleFromDesignation(d?: string): Role {
  const t = (d ?? '').toLowerCase()
  if (/doctor|medical officer|\bmo\b|consultant|physician|registrar|surgeon|\bdr\b/.test(t)) return 'DOCTOR'
  if (/nurse|nursing|midwife|sister|matron/.test(t)) return 'NURSE'
  return 'ALLIED'
}
