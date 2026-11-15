import { route, body, clientMeta } from '@/lib/api'
import { createSchedule, listSchedules, ScheduleInput } from '@/lib/services/schedules'

export const maxDuration = 60 // makes the first two weeks of visits

/** GET — every repeating schedule · POST { fromRequestId, pattern, end, time?, title? } — repeat a request on a schedule. */
export const GET = route(async ({ user }) => ({ items: await listSchedules(user) }))
export const POST = route(async ({ req, user }) => createSchedule(await body(req, ScheduleInput), user, clientMeta(req, user)), { perm: 'requests.manage' })
