/** Slim, serialisable request row used by the board (Kanban + table) client components. */
export type BoardRow = {
  id: string
  requestNo: string
  short: string
  status: string
  priority: string
  patientId: string
  patient: string
  ageGender: string
  phone: string
  area: string
  services: string
  schedule: string
  staff: { id: string; name: string; short: string } | null
  sla: { tone: string; label: string } | null
  /** live elapsed timer (IN_PROGRESS) */
  checkInAt: string | null
  planned: number
  hasSchedule: boolean
}

export type Option = { value: string; label: string }
