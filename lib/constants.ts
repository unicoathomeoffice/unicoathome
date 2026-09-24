// Domain vocabulary shared by API, services and UI. Source: ui/design/uploads/UNICO_HOME_CARE_MODULE_PLAN.md

export const ROLES = [
  'SUPER_ADMIN',
  'HC_ADMIN',
  'FRONT_DESK',
  'DOCTOR',
  'NURSE',
  'ALLIED',
  'DRIVER',
  'TRANSPORT_SUPERVISOR',
  'VIEWER',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  HC_ADMIN: 'Home Care Coordinator',
  FRONT_DESK: 'Front desk',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  ALLIED: 'Allied health',
  DRIVER: 'Driver',
  TRANSPORT_SUPERVISOR: 'Car supervisor',
  VIEWER: 'Management (read-only)',
}

export const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'HC_ADMIN']
export const DESK_ROLES: Role[] = ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK']
export const FIELD_ROLES: Role[] = ['DOCTOR', 'NURSE', 'ALLIED']
export const WEB_DEFAULT_ROLES: Role[] = ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER']

export function defaultPlatformAccess(role: Role): ('web' | 'app')[] {
  if (role === 'VIEWER') return ['web']
  return WEB_DEFAULT_ROLES.includes(role) ? ['web', 'app'] : ['app']
}

// ---- Permissions (plan §3.3, plus transport roles) ----
export const PERMISSIONS = {
  'users.manage': ['SUPER_ADMIN'],
  'users.read': ['SUPER_ADMIN', 'HC_ADMIN', 'TRANSPORT_SUPERVISOR'],
  'master.manage': ['SUPER_ADMIN'],
  'settings.manage': ['SUPER_ADMIN'],
  'templates.manage': ['SUPER_ADMIN', 'HC_ADMIN'],
  'requests.create': ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'DOCTOR', 'NURSE', 'ALLIED'],
  'requests.readAll': ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER'],
  'patients.edit': ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK'],
  'requests.manage': ['SUPER_ADMIN', 'HC_ADMIN'], // verify / confirm / reschedule / cancel / close
  'requests.assign': ['SUPER_ADMIN', 'HC_ADMIN'],
  'visit.execute': ['DOCTOR', 'NURSE', 'ALLIED'],
  'billing.invoice': ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK'],
  'transport.manage': ['SUPER_ADMIN', 'HC_ADMIN', 'TRANSPORT_SUPERVISOR'],
  'transport.drive': ['DRIVER'],
  'messages.send': ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'DOCTOR', 'NURSE', 'ALLIED'],
  'reports.view': ['SUPER_ADMIN', 'HC_ADMIN', 'VIEWER'],
  'audit.view': ['SUPER_ADMIN', 'HC_ADMIN'],
  'approvals.decide': ['SUPER_ADMIN', 'HC_ADMIN'],
} as const satisfies Record<string, readonly Role[]>
export type Permission = keyof typeof PERMISSIONS

export function can(role: Role | string | undefined, perm: Permission): boolean {
  return !!role && (PERMISSIONS[perm] as readonly string[]).includes(role)
}

// ---- Lifecycle (plan §4) ----
export const STATUSES = [
  'NEW',
  'VERIFIED',
  'CONFIRMED',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'COMPLETED',
  'CLOSED',
  'RESCHEDULED',
  'CANCELLED',
] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = {
  NEW: 'New',
  VERIFIED: 'Verified',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'En route',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
}

/** [background, text, dot] — exact values from the design system */
export const STATUS_COLORS: Record<Status, [string, string, string]> = {
  NEW: ['#F1F5F9', '#475569', '#64748B'],
  VERIFIED: ['#DBEAFE', '#1D4ED8', '#2563EB'],
  CONFIRMED: ['#E0E7FF', '#4338CA', '#4F46E5'],
  ASSIGNED: ['#EDE9FE', '#6D28D9', '#7C3AED'],
  ACCEPTED: ['#E8F5FB', '#0072A3', '#0090CA'],
  EN_ROUTE: ['#CFFAFE', '#0E7490', '#0891B2'],
  IN_PROGRESS: ['#FEF3C7', '#B45309', '#F59E0B'],
  COMPLETED: ['#DCFCE7', '#15803D', '#16A34A'],
  CLOSED: ['#D1FAE5', '#065F46', '#065F46'],
  RESCHEDULED: ['#FFEDD5', '#C2410C', '#F97316'],
  CANCELLED: ['#FEE2E2', '#B91C1C', '#DC2626'],
}

export const TRANSITIONS: Record<Status, Status[]> = {
  NEW: ['VERIFIED', 'CONFIRMED', 'CANCELLED'],
  VERIFIED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'RESCHEDULED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'CONFIRMED', 'ASSIGNED', 'RESCHEDULED', 'CANCELLED'],
  ACCEPTED: ['EN_ROUTE', 'IN_PROGRESS', 'ASSIGNED', 'RESCHEDULED', 'CANCELLED'],
  EN_ROUTE: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
  RESCHEDULED: ['CONFIRMED', 'CANCELLED'],
  CANCELLED: [],
}

/** Board columns (W03) */
export const BOARD_COLUMNS: { key: string; label: string; statuses: Status[] }[] = [
  { key: 'new', label: 'New', statuses: ['NEW', 'VERIFIED'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['CONFIRMED', 'RESCHEDULED'] },
  { key: 'assigned', label: 'Assigned', statuses: ['ASSIGNED', 'ACCEPTED'] },
  { key: 'progress', label: 'In progress', statuses: ['EN_ROUTE', 'IN_PROGRESS'] },
  { key: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { key: 'closed', label: 'Closed / cancelled', statuses: ['CLOSED', 'CANCELLED'] },
]

export const ACTIVE_STATUSES: Status[] = ['NEW', 'VERIFIED', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'RESCHEDULED']

export const PRIORITIES = ['ROUTINE', 'URGENT', 'EMERGENCY'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Minutes allowed for NEW → CONFIRMED by priority (plan §4.4) */
export const SLA_CONFIRM_MIN: Record<Priority, number> = { ROUTINE: 15, URGENT: 5, EMERGENCY: 2 }
export const SLA_ASSIGN_MIN = 30
export const SLA_ACCEPT_MIN = 15
export const LATE_AFTER_MIN = 10

export const DECLINE_REASONS = ['Unavailable', 'Too far', 'Skill mismatch', 'Sick', 'Other'] as const

export const SLOTS = ['09–11', '11–13', '15–17', '17–19'] as const

export const ZONES = ['Dhanmondi', 'Mohammadpur', 'Uttara', 'Mirpur', 'Gulshan', 'Banani', 'Motijheel', 'Savar', 'Bashundhara', 'Badda']

export const SKILLS = [
  'iv_cannulation',
  'wound_care',
  'catheter_care',
  'ecg',
  'sample_collection',
  'physio_neuro',
  'paediatric',
  'injection',
  'vaccination',
  'palliative',
  'consultation',
]

export const SHIFTS = ['MORNING', 'EVENING', 'NIGHT', 'FLEX'] as const
export const AVAILABILITY = ['ON_DUTY', 'OFF_DUTY', 'ON_LEAVE'] as const
export const AVAILABILITY_LABEL = { ON_DUTY: 'On duty', OFF_DUTY: 'Off duty', ON_LEAVE: 'On leave' } as const

export const PAYMENT_METHODS = ['CASH', 'BKASH', 'NAGAD', 'CARD'] as const
export const PAYMENT_METHOD_LABEL = { CASH: 'Cash', BKASH: 'bKash', NAGAD: 'Nagad', CARD: 'Card' } as const

/** "Service provided by" in the original Google Form */
export const TRANSPORT_MODES = ['UNICO_CAR', 'RICKSHAW', 'UBER', 'PATHAO', 'OTHER'] as const
export const TRANSPORT_MODE_LABEL = {
  UNICO_CAR: 'Unico @ Home car',
  RICKSHAW: 'Rickshaw',
  UBER: 'Uber',
  PATHAO: 'Pathao',
  OTHER: 'Other',
} as const

export const PETTY_CASH_PURPOSES = ['Consumables', 'Rickshaw / Uber', 'Patient item', 'Other'] as const

export const REQUEST_SOURCES = ['PHONE', 'WALK_IN', 'WHATSAPP', 'WEBSITE', 'APP'] as const

/** "Test / Procedure Details" options from the Google Form */
export const TESTS_PROCEDURES = [
  'CBC',
  'CBC With ESR',
  'Blood Grouping & Rh Factor',
  'Alkaline Phosphatase (ALP)',
  'Fasting Lipid Profile',
  'HBsAg Screening (ICT)',
  'HbA1C',
  'Liver Function Test (LFT)',
  'Phosphate (PO4)',
  'Serum Bilirubin (Total, Direct & Indirect)',
  'Serum Calcium',
  'Serum Creatinine',
  'Serum Uric Acid',
  'Serum Electrolytes',
  'Thyroid Stimulating Hormone (TSH)',
  'Triiodothyronine (T3)',
  'Thyroxine (T4)',
  'Urine Routine Examination',
  'Vitamin D (25-OH)',
  'Dressing',
  'ECG',
  'I/V Injection Pushing',
  'I/M Injection Pushing',
  'S/C Injection Pushing',
  'X-Chest PA View',
  'Ultrasonography of Whole Abdomen',
  'Nebulisation',
] as const

export const VITALS = [
  { key: 'bpSys', label: 'BP systolic', unit: 'mmHg', min: 90, max: 140 },
  { key: 'bpDia', label: 'BP diastolic', unit: 'mmHg', min: 60, max: 90 },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', min: 60, max: 100 },
  { key: 'tempC', label: 'Temperature', unit: '°C', min: 36.1, max: 37.5 },
  { key: 'spo2', label: 'SpO₂', unit: '%', min: 95, max: 100 },
  { key: 'rbs', label: 'RBS', unit: 'mmol/L', min: 3.9, max: 7.8 },
  { key: 'weightKg', label: 'Weight', unit: 'kg', min: 0, max: 300 },
  { key: 'painScore', label: 'Pain score', unit: '/10', min: 0, max: 3 },
] as const

export const NOTE_TYPES = ['GENERAL', 'PATIENT', 'HANDOVER', 'CLINICAL'] as const
export const NOTE_VISIBILITY = ['TEAM', 'COORDINATOR', 'PRIVATE'] as const

export const APPROVAL_TYPES = ['NEW_USER', 'ROLE_CHANGE', 'RESCHEDULE', 'CANCEL', 'HANDOVER', 'PETTY_CASH', 'SERVICE_PROPOSAL'] as const

export const VEHICLE_STATUSES = ['FREE', 'ON_TRIP', 'IN_SERVICE'] as const

export const TZ = 'Asia/Dhaka'
