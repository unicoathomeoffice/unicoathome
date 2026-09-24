import { STATUS_LABEL, type Status } from '@/lib/constants'
import type { BoardRow } from './types'

const cell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build and download a CSV of board rows (client-side, from what is loaded). */
export function downloadCsv(rows: BoardRow[], name = 'requests') {
  const head = ['Request no', 'Patient', 'Age / gender', 'Phone', 'Area', 'Services', 'Priority', 'Status', 'Schedule', 'Staff', 'SLA']
  const lines = rows.map((r) => [r.requestNo, r.patient, r.ageGender, r.phone, r.area, r.services, r.priority, STATUS_LABEL[r.status as Status] ?? r.status, r.schedule, r.staff?.name ?? 'Unassigned', r.sla?.label ?? ''].map(cell).join(','))
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const d = new Date()
  a.download = `${name}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
