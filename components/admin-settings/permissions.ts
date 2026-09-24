import { PERMISSIONS, type Permission, type Role } from '@/lib/constants'

/** Human labels for the permission matrix (A2). Plain module: safe for server and client. */
export const PERMISSION_LABEL: Record<Permission, string> = {
  'users.manage': 'Manage users (create, suspend, reset passwords)',
  'users.read': 'See the staff directory',
  'master.manage': 'Designations, departments, zones, service types',
  'settings.manage': 'Settings & integrations',
  'templates.manage': 'Message templates',
  'requests.create': 'Create request',
  'requests.readAll': 'View all requests & patient board',
  'patients.edit': 'Edit patient registry',
  'requests.manage': 'Verify / confirm / reschedule / cancel / close',
  'requests.assign': 'Assign / reassign staff',
  'visit.execute': 'Accept, check-in, checklist, vitals, complete (own visits)',
  'billing.invoice': 'Issue invoice · print status',
  'transport.manage': 'Assign cars & drivers · manage fleet',
  'transport.drive': 'Drive: pick-up / drop / return stamps',
  'messages.send': 'Send email / WhatsApp from a record',
  'reports.view': 'Reports & export',
  'audit.view': 'Audit log',
  'approvals.decide': 'Approvals (petty cash, reschedules, new users)',
}

export const PERM_KEYS = Object.keys(PERMISSIONS) as Permission[]
export const permsOf = (role: Role) => PERM_KEYS.filter((p) => (PERMISSIONS[p] as readonly string[]).includes(role))

