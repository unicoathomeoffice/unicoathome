import { route, body, clientMeta } from '@/lib/api'
import { editSchedule, scheduleAction, scheduleDetail, ScheduleAction, ScheduleEdit } from '@/lib/services/schedules'

export const maxDuration = 60

/** GET — one schedule · PATCH { pattern?, end?, time?, title? } — change it · POST { action: pause|resume|stop|skip, date?, reason? } */
export const GET = route<{ id: string }>(async ({ user, params }) => scheduleDetail(params.id, user))
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => editSchedule(params.id, await body(req, ScheduleEdit), user, clientMeta(req, user)), { perm: 'requests.manage' })
export const POST = route<{ id: string }>(async ({ req, user, params }) => scheduleAction(params.id, await body(req, ScheduleAction), user, clientMeta(req, user)), { perm: 'requests.manage' })
