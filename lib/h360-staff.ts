import 'server-only'
import { getH360Config, H360Error } from './h360'
import { readOnlyPost } from './h360-items'
import { memo } from './memo'
import type { Role } from './constants'

// Outside staff: hospital employees who are not registered in this app, found with the HIS Roster page's
// "Employee Search" (the same search, read-only). Only work details are taken — name, ID, designation, unit, phone.

export type HisEmployee = { employeeId: string; name: string; designation?: string; department?: string; gender?: string; phone?: string }

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

/** Search HIS employees by name or employee ID (min 2 characters). Max 15, cached 60 s per term. */
export async function searchHisEmployees(q: string): Promise<HisEmployee[]> {
  const term = q.trim()
  if (term.length < 2) return []
  if (!(await getH360Config())) throw new H360Error('NOT_CONFIGURED', 'H360 is not connected')
  return memo(`h360s:${term.toLowerCase()}`, 60_000, async () => {
    const res = await readOnlyPost('/doctor-info-autocomplete', { search_data: term, personnel_ind_name: 'employee_ind', personnel_ind: '1' })
    if (!res.ok) throw new H360Error('DOWN', `H360 employee search answered ${res.status}`)
    const json: any = await res.json().catch(() => null)
    const rows: any[] = Array.isArray(json) ? json : (json?.data ?? [])
    return rows
      .filter((r) => r?.person_code && r?.full_name)
      .slice(0, 15)
      .map((r) => ({
        employeeId: clean(String(r.person_code)),
        name: clean(r.full_name),
        designation: clean(r.designation) || undefined,
        department: clean(r.su_name) || undefined,
        gender: clean(r.gender_txt) || undefined,
        phone: clean(r.phone_mobile) || undefined,
      }))
  })
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
