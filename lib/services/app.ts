import 'server-only'
import { db } from '../db'
import { Approval, Department, Equipment, HomecareRequest, StoreLoan } from '../models'
import { unreadCount } from '../unread'
import { pendingCount } from '../wa/outbox'
import { linkState } from '../wa/status'
import { getSettings } from '../settings'
import { modulesFor, tabsFor } from '../app-modules'
import type { SessionUser } from '../auth'
import {
  ACTIVE_STATUSES,
  ALERT_EVENTS,
  ALERT_EVENT_LABEL,
  AVAILABILITY,
  AVAILABILITY_LABEL,
  BLOOD_GROUPS,
  BOARD_COLUMNS,
  DECLINE_REASONS,
  NOTE_TYPES,
  NOTE_VISIBILITY,
  PATIENT_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PETTY_CASH_PURPOSES,
  PRIORITIES,
  RELATIONS,
  REQUEST_SOURCES,
  ROLES,
  ROLE_LABEL,
  SKILLS,
  STATUSES,
  STATUS_COLORS,
  STATUS_LABEL,
  TRANSITIONS,
  TRANSPORT_MODES,
  TRANSPORT_MODE_LABEL,
  VITALS,
  can,
  canOpenSettings,
  permissionsFor,
} from '../constants'

/** The developer credit shown on sign-in screens, About and staff page footers (web and app). */
export const CREDIT = { text: 'Design and developed by', name: 'Nasif Ahammed Niloy', site: 'nasifahammedniloy.com', url: 'https://nasifahammedniloy.com' }

/** Lifecycle constants the app needs to draw chips, boards and forms. Sent with the config so nothing is hard-coded. */
function enums() {
  return {
    roles: ROLES.map((r) => ({ key: r, label: ROLE_LABEL[r] })),
    statuses: STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], colors: STATUS_COLORS[s], next: TRANSITIONS[s] })),
    activeStatuses: ACTIVE_STATUSES,
    boardColumns: BOARD_COLUMNS,
    priorities: PRIORITIES,
    declineReasons: DECLINE_REASONS,
    skills: SKILLS,
    availability: AVAILABILITY.map((a) => ({ key: a, label: AVAILABILITY_LABEL[a] })),
    paymentMethods: PAYMENT_METHODS.map((p) => ({ key: p, label: PAYMENT_METHOD_LABEL[p] })),
    transportModes: TRANSPORT_MODES.map((m) => ({ key: m, label: (TRANSPORT_MODE_LABEL as Record<string, string>)[m] ?? m })),
    patientCategories: PATIENT_CATEGORIES,
    relations: RELATIONS,
    bloodGroups: BLOOD_GROUPS,
    pettyCashPurposes: PETTY_CASH_PURPOSES,
    requestSources: REQUEST_SOURCES,
    noteTypes: NOTE_TYPES,
    noteVisibility: NOTE_VISIBILITY,
    vitals: VITALS,
    alertEvents: ALERT_EVENTS.map((e) => ({ key: e, label: ALERT_EVENT_LABEL[e] })),
  }
}

/** Badge numbers for tabs, the "More" grid and the web sidebar. Only counts this person is allowed to see. */
export async function badgesFor(user: SessionUser) {
  await db()
  const desk = can(user, 'requests.readAll')
  const storeOn = can(user, 'requests.manage') || can(user, 'store.manage')
  const [unread, open, outbox, approvals, lowStock, overdueLoans] = await Promise.all([
    unreadCount(user.id),
    desk ? HomecareRequest.countDocuments({ status: { $in: ACTIVE_STATUSES }, deletedAt: null }) : 0,
    can(user, 'messages.approve') ? pendingCount() : 0,
    can(user, 'approvals.decide') ? Approval.countDocuments({ status: 'PENDING' }) : 0,
    storeOn
      ? Equipment.countDocuments({ isActive: { $ne: false }, $or: [{ stock: { $lte: 0 } }, { $expr: { $and: [{ $gt: ['$alertBelow', 0] }, { $lte: ['$stock', '$alertBelow'] }] } }] })
      : 0,
    storeOn ? StoreLoan.countDocuments({ status: { $in: ['OPEN', 'PARTLY_RETURNED'] }, dueAt: { $lt: new Date() } }) : 0,
  ])
  return { unread, open, outbox, approvals, store: lowStock + overdueLoans }
}

/**
 * Everything the native app needs to draw itself for this person: who they are, what they may do, which modules
 * and tabs they see, the lifecycle constants and the client-side settings. Changing a role, a feature toggle or
 * App control in Settings changes the app on its next refresh, with no new APK.
 */
export async function appConfig(user: SessionUser, appBuild?: number) {
  const settings = await getSettings()
  const app = settings.app
  const modules = modulesFor(user, app.hiddenModules)
  // a head of department gets their department's board
  if (await Department.exists({ headIds: user.id, isActive: { $ne: false } })) modules.push({ key: 'hod', label: 'My department', group: 'People', icon: 'groups' } as any)
  const [badges, wa] = await Promise.all([badgesFor(user), can(user, 'messages.approve') || can(user, 'messages.send') || canOpenSettings(user) ? linkState().catch(() => null) : null])
  return {
    user,
    permissions: permissionsFor(user),
    modules,
    tabs: tabsFor(user, modules),
    badges,
    features: settings.features,
    general: {
      hospitalName: settings.general.hospitalName,
      department: settings.general.department,
      hospitalPhone: settings.general.hospitalPhone,
      workingHours: settings.general.workingHours,
      slots: settings.general.slots,
      hospitalLocation: settings.general.hospitalLocation,
    },
    sla: settings.sla,
    quietHours: settings.quietHours,
    whatsapp: { approval: settings.whatsapp.approval, link: wa?.state ?? null },
    enums: enums(),
    app: {
      latestBuild: app.latestBuild,
      latestVersion: app.latestVersion,
      releaseNotes: app.releaseNotes,
      updateAvailable: !!app.apkAttachmentId && appBuild != null && app.latestBuild > appBuild,
      mustUpdate: appBuild != null && app.minBuild > 0 && appBuild < app.minBuild,
      maintenance: app.maintenance || null,
      apiBase: app.apiBase || null,
    },
    credit: CREDIT,
    serverTime: new Date().toISOString(),
  }
}
