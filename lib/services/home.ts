import 'server-only'
import { db } from '../db'
import { HomecareRequest, Note } from '../models'
import { withPeople } from './requests'
import { unreadCount } from '../unread'
import { DESK_ROLES, type Role } from '../constants'
import { dayRange } from '../format'
import type { SessionUser } from '../auth'

const ACTIVE = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS']

/** Visits where this person is on the care team (primary or secondary). */
export const teamOf = (user: SessionUser) => ({ $or: [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }] })

/**
 * The field "Today" screen (web /m, GET /api/v1/app/home): today's visits (every visit for the desk roles), the
 * hero visit (in progress, else on the way, else the next one), awaiting-accept count, own notes and unread.
 */
export async function myDay(user: SessionUser) {
  await db()
  const desk = DESK_ROLES.includes(user.role as Role)
  const mine = teamOf(user)
  const { start, end } = dayRange()
  const todayFilter: any = { deletedAt: null, scheduledAt: { $gte: start, $lt: end }, status: { $nin: ['CANCELLED', 'NEW', 'VERIFIED'] } }
  if (!desk) Object.assign(todayFilter, mine)

  const [today, next, awaiting, notes, unread] = await Promise.all([
    HomecareRequest.find(todayFilter).select('-visit.notes -deviceStamps -clinical.notes').sort({ scheduledAt: 1 }).limit(60).lean<any[]>(),
    HomecareRequest.find({ deletedAt: null, ...mine, status: { $in: ACTIVE }, scheduledAt: { $gte: new Date(start.getTime() - 86400_000) } })
      .select('requestNo status scheduledAt patientSnapshot services expectedDurationMin timeline patientId')
      .sort({ scheduledAt: 1 })
      .limit(10)
      .lean<any[]>(),
    HomecareRequest.countDocuments({ deletedAt: null, status: 'ASSIGNED', ...(desk ? {} : { 'assignment.primaryStaffId': user.id }) }),
    Note.countDocuments({ authorId: user.id, deletedAt: null }),
    unreadCount(user.id),
  ])
  await withPeople(today)
  const hero = next.find((r) => r.status === 'IN_PROGRESS') ?? next.find((r) => r.status === 'EN_ROUTE') ?? next.find((r) => new Date(r.scheduledAt).getTime() > Date.now() - 60 * 60_000) ?? null
  const completed = today.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length
  return { desk, today, hero, awaiting, notes, unread, completed }
}
