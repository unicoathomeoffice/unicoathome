import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUser } from '@/lib/auth'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { loadPatientBoard } from '@/components/people/patient-board'
import { date, time } from '@/lib/format'

/** GET /patients/export — CSV of the patient board with the same filters as the page. */
export async function GET(req: NextRequest) {
  await db()
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))
  if (!can(user, 'requests.readAll') || user.role === 'VIEWER') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to export patients' } }, { status: 403 })
  }
  const p = req.nextUrl.searchParams
  const get = (k: string) => p.get(k) ?? undefined
  const rows = await loadPatientBoard({ q: get('q'), zone: get('zone'), status: get('status'), priority: get('priority'), staff: get('staff'), service: get('service') })
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Patient', 'Age', 'Gender', 'Phone', 'UHID', 'Zone', 'Visits', 'Latest request', 'Status', 'Priority', 'Service', 'Next visit', 'Staff']
  const lines = rows.map((r) => {
    const c = r.current
    return [r.name, r.ageYears, r.gender, r.phone, r.uhid, r.zone, r.visits, c?.requestNo, c?.status, c?.priority, c?.service, c?.scheduledAt ? `${date(c.scheduledAt)} ${time(c.scheduledAt)}` : '', c?.staffName].map(cell).join(',')
  })
  await audit(user, 'patient.export', 'patient', null, { after: { rows: rows.length, filters: Object.fromEntries(p) }, label: 'Patient board CSV' }, { ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? '', userAgent: req.headers.get('user-agent') ?? '', client: 'web' })
  return new Response('﻿' + [head.join(','), ...lines].join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="patients-${new Date().toISOString().slice(0, 10)}.csv"` },
  })
}
