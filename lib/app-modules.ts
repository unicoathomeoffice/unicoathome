import { can, canOpenSettings, canViewMessages, hasRole, type Actor, type Permission } from './constants'

/**
 * The native app's module catalogue (GET /api/v1/app/config). The app draws its tabs and its "More" grid from this
 * list, so who sees what is decided here, on the server, with the same rules as the web sidebar
 * (components/admin/Sidebar.tsx) and the field app tabs (components/mobile tabsFor). Keys are stable: the Android
 * app maps each key to a screen, so never rename one; add new keys instead.
 */
export type AppModule = {
  key: string
  label: string
  group: 'Operations' | 'People' | 'Field' | 'Transport' | 'Communication' | 'Store' | 'Insights' | 'Settings' | 'Me'
  /** Material Symbols name, drawn by the app */
  icon: string
  /** badge key from GET /app/badges */
  badge?: string
}

type Rule = Permission | ((u: Actor) => boolean)
type Entry = AppModule & { rule?: Rule }

const field = (u: Actor) => can(u, 'visit.execute')
const desk = (u: Actor) => can(u, 'requests.readAll')
const driver = (u: Actor) => hasRole(u, 'DRIVER')
const transport = (u: Actor) => can(u, 'transport.manage')

const CATALOGUE: Entry[] = [
  // ---- operations (web: Dashboard, Requests, Live map, Search)
  { key: 'dashboard', label: 'Dashboard', group: 'Operations', icon: 'space_dashboard', rule: (u) => !driver(u) },
  { key: 'requests', label: 'Requests', group: 'Operations', icon: 'view_kanban', badge: 'open', rule: 'requests.readAll' },
  { key: 'new_request', label: 'New request', group: 'Operations', icon: 'add_circle', rule: 'requests.create' },
  { key: 'live', label: 'Live map', group: 'Operations', icon: 'share_location', rule: 'requests.readAll' },
  { key: 'search', label: 'Search', group: 'Operations', icon: 'search', rule: (u) => !driver(u) },
  // ---- field work (web /m)
  { key: 'visits', label: 'My visits', group: 'Field', icon: 'medical_services', rule: (u) => field(u) || desk(u) },
  { key: 'route', label: 'Day route', group: 'Field', icon: 'route', rule: (u) => field(u) || desk(u) },
  { key: 'care_plans', label: 'Care plans', group: 'Field', icon: 'event_repeat', rule: 'requests.create' },
  { key: 'notes', label: 'Notes & handovers', group: 'Field', icon: 'sticky_note_2', rule: (u) => !driver(u) && !hasRole(u, 'TRANSPORT_SUPERVISOR') },
  { key: 'my_claims', label: 'My claims', group: 'Field', icon: 'receipt_long' },
  // ---- people
  { key: 'patients', label: 'Patients', group: 'People', icon: 'groups', rule: 'requests.readAll' },
  { key: 'staff', label: 'Staff', group: 'People', icon: 'badge', rule: 'users.read' },
  { key: 'approvals', label: 'Approvals', group: 'People', icon: 'task_alt', badge: 'approvals', rule: 'approvals.decide' },
  { key: 'claims', label: 'Claims', group: 'People', icon: 'request_quote', rule: 'approvals.decide' },
  // ---- transport
  { key: 'trips', label: 'Trips', group: 'Transport', icon: 'local_shipping', rule: (u) => driver(u) || transport(u) },
  { key: 'vehicle', label: 'My vehicle', group: 'Transport', icon: 'directions_car', rule: driver },
  { key: 'fleet', label: 'Fleet & drivers', group: 'Transport', icon: 'garage', rule: transport },
  // ---- communication
  { key: 'whatsapp', label: 'WhatsApp', group: 'Communication', icon: 'chat', badge: 'outbox', rule: 'messages.approve' },
  { key: 'messages', label: 'Messages log', group: 'Communication', icon: 'mail', rule: canViewMessages },
  { key: 'notifications', label: 'Notifications', group: 'Communication', icon: 'notifications', badge: 'unread' },
  { key: 'templates', label: 'Templates', group: 'Communication', icon: 'edit_note', rule: 'templates.manage' },
  // ---- store
  { key: 'store', label: 'Store', group: 'Store', icon: 'inventory_2', badge: 'store', rule: (u) => can(u, 'requests.manage') || can(u, 'store.manage') },
  // ---- insights
  { key: 'reports', label: 'Reports', group: 'Insights', icon: 'monitoring', rule: 'reports.view' },
  { key: 'audit', label: 'Audit log', group: 'Insights', icon: 'history', rule: 'audit.view' },
  // ---- settings (web /settings/*)
  { key: 'settings_general', label: 'General & integrations', group: 'Settings', icon: 'tune', rule: canOpenSettings },
  { key: 'settings_whatsapp', label: 'WhatsApp connection', group: 'Settings', icon: 'qr_code_scanner', rule: canOpenSettings },
  { key: 'settings_notifications', label: 'Notification control', group: 'Settings', icon: 'notifications_active', rule: canOpenSettings },
  { key: 'settings_designations', label: 'Designations & departments', group: 'Settings', icon: 'account_tree', rule: 'master.manage' },
  { key: 'settings_services', label: 'Service types', group: 'Settings', icon: 'medical_information', rule: 'requests.manage' },
  { key: 'settings_roles', label: 'Roles & permissions', group: 'Settings', icon: 'admin_panel_settings', rule: 'users.manage' },
  { key: 'settings_zones', label: 'Zones, slots & rules', group: 'Settings', icon: 'map', rule: 'requests.manage' },
  { key: 'settings_booking', label: 'Online booking', group: 'Settings', icon: 'calendar_month', rule: 'requests.manage' },
  { key: 'settings_maps', label: 'Maps & API usage', group: 'Settings', icon: 'travel_explore', rule: canOpenSettings },
  { key: 'settings_app', label: 'App control', group: 'Settings', icon: 'phone_android', rule: 'settings.manage' },
  // ---- me
  { key: 'account', label: 'My account', group: 'Me', icon: 'account_circle' },
  { key: 'help', label: 'Help', group: 'Me', icon: 'help' },
  { key: 'about', label: 'About', group: 'Me', icon: 'info' },
]

const allowed = (u: Actor, rule?: Rule) => (rule == null ? true : typeof rule === 'function' ? rule(u) : can(u, rule))

/** Every module this person may open, in catalogue order. `hidden` lets an admin switch modules off per role. */
export function modulesFor(u: Actor & { role: string }, hidden: Record<string, string[]> = {}): AppModule[] {
  const off = new Set(hidden[u.role] ?? [])
  return CATALOGUE.filter((m) => !off.has(m.key) && allowed(u, m.rule)).map(({ rule: _r, ...m }) => m)
}

/** Bottom tabs (max 4; the fifth slot is always "More"), following the field app's tabsFor(). */
export function tabsFor(u: Actor & { role: string }, modules: AppModule[]): string[] {
  const has = new Set(modules.map((m) => m.key))
  const pick = (keys: string[]) => keys.filter((k) => has.has(k)).slice(0, 4)
  if (hasRole(u, 'DRIVER') && !desk(u)) return pick(['trips', 'vehicle', 'notifications'])
  if (hasRole(u, 'TRANSPORT_SUPERVISOR') && !desk(u)) return pick(['trips', 'fleet', 'dashboard', 'notifications'])
  if (can(u, 'messages.approve')) return pick(['dashboard', 'requests', 'whatsapp', 'notifications'])
  if (desk(u)) return pick(['dashboard', 'requests', 'patients', 'notifications'])
  return pick(['visits', 'dashboard', 'notes', 'notifications'])
}

export const MODULE_KEYS = CATALOGUE.map((m) => m.key)
